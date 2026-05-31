/*
 * Native Land API helper for browser usage.
 * Note: API keys in frontend code are visible to users; move requests to a server if you need secrecy.
 */

(function initNativeLandApi(globalScope) {
	const DEFAULT_API_KEY = "IJjBz_2GNsEeu_YYJMVMa";
	const API_ROOT = "https://native-land.ca/api";

	let apiKey = DEFAULT_API_KEY;

	function toCsv(values) {
		if (Array.isArray(values)) {
			return values.join(",");
		}
		return String(values);
	}

	function requireXlsx() {
		if (typeof globalScope.XLSX === "undefined") {
			throw new Error("XLSX is not available. Load SheetJS before using Excel helpers.");
		}

		return globalScope.XLSX;
	}

	async function fetchJson(url, options) {
		const response = await fetch(url, options);

		if (!response.ok) {
			const bodyText = await response.text();
			throw new Error(`Native Land request failed (${response.status}): ${bodyText}`);
		}

		return response.json();
	}

	function normalizeText(value) {
		return String(value ?? "")
			.trim()
			.toLowerCase()
			.replace(/[\s_\-]+/g, "")
			.replace(/[^a-z0-9]/g, "");
	}

	function parseNumber(value) {
		if (typeof value === "number") {
			return value;
		}

		const parsed = Number.parseFloat(String(value ?? "").replace(/,/g, "").trim());
		return Number.isFinite(parsed) ? parsed : NaN;
	}

	function detectColumn(rows, candidates) {
		if (!Array.isArray(rows) || !rows.length) {
			return null;
		}

		const keys = Object.keys(rows[0] || {});
		for (const candidate of candidates) {
			const normalizedCandidate = normalizeText(candidate);
			const match = keys.find((key) => normalizeText(key) === normalizedCandidate);
			if (match) {
				return match;
			}
		}

		return null;
	}

	function splitValues(value) {
		return String(value ?? "")
			.split(/[;,|]/)
			.map((entry) => entry.trim())
			.filter(Boolean);
	}

	async function getSpreadsheetRows(source, options = {}) {
		const XLSX = requireXlsx();
		const workbook = await loadWorkbook(source);
		const sheetName = options.sheetName || workbook.SheetNames[0];
		if (!sheetName) {
			throw new Error("The workbook does not contain any sheets.");
		}

		const worksheet = workbook.Sheets[sheetName];
		return XLSX.utils.sheet_to_json(worksheet, { defval: "" });
	}

	async function loadWorkbook(source) {
		const XLSX = requireXlsx();

		if (!source) {
			throw new Error("An Excel source is required.");
		}

		if (source.SheetNames && source.Sheets) {
			return source;
		}

		let arrayBuffer;

		if (source instanceof ArrayBuffer) {
			arrayBuffer = source;
		} else if (ArrayBuffer.isView(source)) {
			arrayBuffer = source.buffer;
		} else if (typeof File !== "undefined" && source instanceof File) {
			arrayBuffer = await source.arrayBuffer();
		} else if (typeof Blob !== "undefined" && source instanceof Blob) {
			arrayBuffer = await source.arrayBuffer();
		} else if (typeof source === "string") {
			const response = await fetch(source);
			if (!response.ok) {
				throw new Error(`Failed to load Excel source ${source} (${response.status})`);
			}
			arrayBuffer = await response.arrayBuffer();
		} else {
			throw new Error("Unsupported Excel source type.");
		}

		return XLSX.read(arrayBuffer, { type: "array" });
	}

	function getParkField(rows) {
		return detectColumn(rows, [
			"ParkName",
			"Park",
			"Unit Name",
			"Name",
			"National Park"
		]);
	}

	function getLatitudeField(rows) {
		return detectColumn(rows, ["Latitude", "Lat", "Y"]);
	}

	function getLongitudeField(rows) {
		return detectColumn(rows, ["Longitude", "Long", "Lon", "Lng", "X"]);
	}

	function getNativeLandField(rows) {
		const field = detectColumn(rows, [
			"NativeLand",
			"Native Lands",
			"Native Land",
			"Indigenous Land",
			"Tribal Nation",
			"Tribe",
			"Territory",
			"Nations",
			"Nation"
		]);

		if (field) {
			return field;
		}

		const sample = rows[0] || {};
		return Object.keys(sample).find((key) => /native|tribe|territor|nation|land/i.test(key)) || null;
	}

	function normalizeLandNames(value) {
		return splitValues(value);
	}

	function filterRowsByNativeLand(rows, nativeLandNames, options = {}) {
		const wanted = splitValues(nativeLandNames).map(normalizeText);
		if (!wanted.length) {
			return rows.slice();
		}

		const nativeLandField = options.nativeLandField || getNativeLandField(rows);
		if (!nativeLandField) {
			return [];
		}

		return rows.filter((row) => {
			const values = normalizeLandNames(row[nativeLandField]).map(normalizeText);
			return values.some((value) => wanted.includes(value));
		});
	}

	function buildNativeLandRequest(row, rows, options = {}) {
		const parkField = options.parkField || getParkField(rows);
		const latitudeField = options.latitudeField || getLatitudeField(rows);
		const longitudeField = options.longitudeField || getLongitudeField(rows);
		const nativeLandField = options.nativeLandField || getNativeLandField(rows);
		const maps = options.maps || ["territories", "treaties", "languages"];

		const parkName = parkField ? String(row[parkField] ?? "").trim() : "";
		const latitude = latitudeField ? parseNumber(row[latitudeField]) : NaN;
		const longitude = longitudeField ? parseNumber(row[longitudeField]) : NaN;
		const nativeLandNames = nativeLandField ? normalizeLandNames(row[nativeLandField]) : [];

		return {
			parkName,
			latitude: Number.isFinite(latitude) ? latitude : null,
			longitude: Number.isFinite(longitude) ? longitude : null,
			nativeLandNames,
			maps
		};
	}

	async function lookupNativeLandForRow(row, rows, options = {}) {
		const request = buildNativeLandRequest(row, rows, options);
		const hasPosition = Number.isFinite(request.latitude) && Number.isFinite(request.longitude);
		const hasNames = request.nativeLandNames.length > 0;

		if (!hasPosition && !hasNames) {
			return {
				row,
				parkName: request.parkName,
				matches: []
			};
		}

		let matches;
		if (hasPosition && hasNames) {
			matches = await NativeLandAPI.getBoundariesByPositionAndName(request.latitude, request.longitude, request.nativeLandNames, request.maps);
		} else if (hasPosition) {
			matches = await NativeLandAPI.getBoundariesByPosition(request.latitude, request.longitude, request.maps);
		} else {
			matches = await NativeLandAPI.getBoundariesByName(request.nativeLandNames, request.maps);
		}

		return {
			row,
			parkName: request.parkName,
			matches
		};
	}

	async function connectNationalParksToNativeLands(source, options = {}) {
		const rows = await getSpreadsheetRows(source, options);
		const filteredRows = options.nativeLandNames
			? filterRowsByNativeLand(rows, options.nativeLandNames, options)
			: rows;

		const limit = Number.isInteger(options.limit) ? options.limit : filteredRows.length;
		const selectedRows = filteredRows.slice(0, limit);

		const results = [];
		for (const row of selectedRows) {
			// Keep requests sequential by default so large workbooks do not hammer the API.
			// Callers can batch their own workbook if they need different behavior.
			// eslint-disable-next-line no-await-in-loop
			results.push(await lookupNativeLandForRow(row, rows, options));
		}

		return results;
	}

	function buildByPositionUrl(maps, latitude, longitude, names) {
		const query = new URLSearchParams({
			maps: toCsv(maps),
			position: `${latitude},${longitude}`,
			key: apiKey
		});

		if (names && names.length) {
			query.set("name", toCsv(names));
		}

		return `${API_ROOT}/index.php?${query.toString()}`;
	}

	const NativeLandAPI = {
		setApiKey(nextKey) {
			if (!nextKey || typeof nextKey !== "string") {
				throw new Error("API key must be a non-empty string.");
			}
			apiKey = nextKey.trim();
		},

		getApiKey() {
			return apiKey;
		},

		async getBoundariesByPosition(latitude, longitude, maps = ["territories", "treaties", "languages"]) {
			const url = buildByPositionUrl(maps, latitude, longitude);
			return fetchJson(url);
		},

		async getBoundariesByName(names, maps = ["territories", "treaties", "languages"]) {
			const query = new URLSearchParams({
				maps: toCsv(maps),
				name: toCsv(names),
				key: apiKey
			});

			return fetchJson(`${API_ROOT}/index.php?${query.toString()}`);
		},

		async getBoundariesByPositionAndName(latitude, longitude, names, maps = ["territories", "treaties", "languages"]) {
			const url = buildByPositionUrl(maps, latitude, longitude, names);
			return fetchJson(url);
		},

		async getFullGeoJson(category) {
			const normalized = String(category || "").trim();
			if (!["territories", "languages", "treaties"].includes(normalized)) {
				throw new Error("category must be one of: territories, languages, treaties");
			}

			const query = new URLSearchParams({ key: apiKey });
			const url = `${API_ROOT}/polygons/geojson/${normalized}?${query.toString()}`;
			return fetchJson(url);
		},

		async getBoundariesByPolygon(featureCollection, maps = ["territories", "treaties", "languages"]) {
			const requestBody = {
				key: apiKey,
				maps: toCsv(maps),
				polygon_geojson: featureCollection
			};

			return fetchJson(`${API_ROOT}/index.php`, {
				method: "POST",
				headers: {
					"Content-Type": "application/json"
				},
				body: JSON.stringify(requestBody)
			});
		},

		loadWorkbook,
		getSpreadsheetRows,
		getParkField,
		getLatitudeField,
		getLongitudeField,
		getNativeLandField,
		filterRowsByNativeLand,
		buildNativeLandRequest,
		lookupNativeLandForRow,
		connectNationalParksToNativeLands
	};

	globalScope.NativeLandAPI = NativeLandAPI;

	if (typeof module !== "undefined" && module.exports) {
		module.exports = NativeLandAPI;
	}
})(typeof window !== "undefined" ? window : globalThis);
