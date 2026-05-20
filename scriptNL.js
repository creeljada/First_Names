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

	async function fetchJson(url, options) {
		const response = await fetch(url, options);

		if (!response.ok) {
			const bodyText = await response.text();
			throw new Error(`Native Land request failed (${response.status}): ${bodyText}`);
		}

		return response.json();
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
		}
	};

	globalScope.NativeLandAPI = NativeLandAPI;

	if (typeof module !== "undefined" && module.exports) {
		module.exports = NativeLandAPI;
	}
})(typeof window !== "undefined" ? window : globalThis);
