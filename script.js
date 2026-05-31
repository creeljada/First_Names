const GEOJSON_PATH = "Data/Top10NP.json";
const EXCEL_PATH = "Data/NP_NL.xlsx";
const KNOWN_PARK_COORDINATES = {
	"Great Smoky Mountains NP": [35.6118, -83.4895],
	"Grand Canyon NP": [36.1069, -112.1129],
	"Yosemite NP": [37.8651, -119.5383],
	"Rocky Mountain NP": [40.3428, -105.6836],
	"Yellowstone NP": [44.4280, -110.5885],
	"Olympic NP": [47.8021, -123.6044],
	"Acadia NP": [44.3386, -68.2733],
	"Zion NP": [37.2982, -113.0263],
	"Grand Teton NP": [43.7904, -110.6818],
	"Gateway Arch NP": [38.6247, -90.1848]
};
const PARK_OVERLAY_COLORS = [
	"#b80c09",
	"#0b4f6c",
	"#006e90",
	"#073b3a",
	"#5f0f40",
	"#8a5a44",
	"#2d6a4f",
	"#7f5539",
	"#577590",
	"#7b2cbf"
];

var map = createBaseMap("map");
var map2 = createBaseMap("map2");

initialize();

async function initialize() {
	try {
		if (!window.NativeLandAPI) {
			throw new Error("NativeLandAPI is not loaded. Ensure scriptNL.js is included before script.js.");
		}

		const [geojson, excelRows] = await Promise.all([
			loadJson(GEOJSON_PATH),
			window.NativeLandAPI.getSpreadsheetRows(EXCEL_PATH)
		]);

		const features = normalizeFeatures(geojson);

		if (!features.length) {
			throw new Error("No parks were found in Data/Top10NP.json.");
		}

		const aligned = realignFeatureGeometriesByKnownCentroids(features);

		const enriched = attachNativeLandData(aligned, excelRows);
		const selectedNativeLand = getSelectedNativeLand();
		const filtered = filterByNativeLand(enriched, selectedNativeLand);

		if (!filtered.length) {
			throw new Error(`No parks matched the selected Native Land filter: ${selectedNativeLand}`);
		}

		drawParks(filtered, map, {
			color: "#084c61",
			fillColor: "#2fa8c6",
			fillOpacity: 0.45,
			popupMode: "parkFirst"
		});
		drawParks(filtered, map2, {
			color: "#2f4858",
			fillColor: "#5aa9e6",
			fillOpacity: 0.2,
			popupMode: "nativeFirst"
		});
		await overlayNativeLandBoundariesForParks(filtered, map2);
		renderSummary(filtered, selectedNativeLand);
	} catch (error) {
		renderError(error);
	}
}

async function overlayNativeLandBoundariesForParks(features, targetMap) {
	const overlayGroup = L.layerGroup().addTo(targetMap);

	for (let index = 0; index < features.length; index += 1) {
		const feature = features[index];
		const parkName = String(feature.properties?.parkName || feature.properties?.NAME || "Unknown park").trim();
		const nativeLandNames = feature.properties?.nativeLands || [];
		const centroid = estimateCentroid(feature.geometry);

		if (!nativeLandNames.length || !centroid) {
			continue;
		}

		try {
			// Query by park position to get local boundaries, then match connected native-land names from NP_NL.xlsx.
			const response = await window.NativeLandAPI.getBoundariesByPosition(centroid[0], centroid[1], ["territories"]);
			const apiFeatures = normalizeNativeLandApiFeatures(response);
			const matchedFeatures = matchNativeLandFeaturesToPark(apiFeatures, nativeLandNames);

			if (!matchedFeatures.length) {
				continue;
			}

			const color = PARK_OVERLAY_COLORS[index % PARK_OVERLAY_COLORS.length];
			L.geoJSON({ type: "FeatureCollection", features: matchedFeatures }, {
				style: {
					color,
					weight: 2,
					fillColor: color,
					fillOpacity: 0.22
				},
				onEachFeature: (nativeLandFeature, nativeLayer) => {
					const nativeLandName = getNativeLandFeatureName(nativeLandFeature) || "Native Land";
					nativeLayer.bindPopup(
						`<strong>${escapeHtml(nativeLandName)}</strong><br>` +
						`<small>National Park: ${escapeHtml(parkName)}</small>`
					);
				}
			}).addTo(overlayGroup);
		} catch (error) {
			console.warn(`Native Land boundary overlay failed for ${parkName}:`, error);
		}
	}
}

function normalizeNativeLandApiFeatures(response) {
	if (!response) {
		return [];
	}

	if (response.type === "FeatureCollection" && Array.isArray(response.features)) {
		return response.features;
	}

	if (Array.isArray(response)) {
		if (response.length && response[0]?.type === "Feature") {
			return response;
		}

		return response
			.filter((entry) => entry && entry.geometry)
			.map((entry) => entry.type === "Feature" ? entry : ({
				type: "Feature",
				geometry: entry.geometry,
				properties: entry.properties || entry
			}));
	}

	if (response.features && Array.isArray(response.features)) {
		return response.features;
	}

	return [];
}

function getNativeLandFeatureName(feature) {
	const props = feature?.properties || {};
	return props.Name || props.name || props.Title || props.title || props.slug || props.Slug || null;
}

function matchNativeLandFeaturesToPark(apiFeatures, nativeLandNames) {
	if (!nativeLandNames.length) {
		return [];
	}

	const wanted = nativeLandNames.map((name) => normalizeKey(name));

	return apiFeatures.filter((feature) => {
		const apiName = normalizeKey(getNativeLandFeatureName(feature) || "");
		if (!apiName) {
			return false;
		}

		return wanted.some((target) => apiName.includes(target) || target.includes(apiName));
	});
}

function createBaseMap(elementId) {
	var instance = L.map(elementId).setView([39.5, -98.35], 4);
	L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
		attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
	}).addTo(instance);
	return instance;
}

function realignFeatureGeometriesByKnownCentroids(features) {
	const available = features.map((feature) => ({
		geometry: feature.geometry,
		centroid: estimateCentroid(feature.geometry)
	}));

	return features.map((feature) => {
		const parkName = String(feature.properties?.parkName || feature.properties?.NAME || "").trim();
		const target = KNOWN_PARK_COORDINATES[parkName];

		if (!target || !available.length) {
			return feature;
		}

		let bestIndex = -1;
		let bestDistance = Number.POSITIVE_INFINITY;

		for (let index = 0; index < available.length; index += 1) {
			const candidate = available[index];
			if (!candidate.centroid) {
				continue;
			}

			const distance = distanceSquared(target, candidate.centroid);
			if (distance < bestDistance) {
				bestDistance = distance;
				bestIndex = index;
			}
		}

		if (bestIndex < 0) {
			return feature;
		}

		const [assigned] = available.splice(bestIndex, 1);
		return {
			...feature,
			geometry: assigned.geometry
		};
	});
}

function distanceSquared(a, b) {
	const dLat = a[0] - b[0];
	const dLon = a[1] - b[1];
	return dLat * dLat + dLon * dLon;
}

function estimateCentroid(geometry) {
	if (!geometry || !geometry.coordinates) {
		return null;
	}

	const points = [];
	collectPoints(geometry.coordinates, points);

	if (!points.length) {
		return null;
	}

	let latSum = 0;
	let lonSum = 0;
	for (const [lon, lat] of points) {
		lonSum += lon;
		latSum += lat;
	}

	return [latSum / points.length, lonSum / points.length];
}

function collectPoints(node, output) {
	if (!Array.isArray(node) || !node.length) {
		return;
	}

	if (typeof node[0] === "number" && typeof node[1] === "number") {
		output.push([node[0], node[1]]);
		return;
	}

	for (const child of node) {
		collectPoints(child, output);
	}
}

function getSelectedNativeLand() {
	const params = new URLSearchParams(window.location.search);
	return (params.get("nativeLand") || "").trim();
}

function normalizeKey(value) {
	return String(value ?? "")
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]/g, "");
}

function parseNumber(value) {
	if (typeof value === "number") {
		return value;
	}

	const cleaned = String(value ?? "").replace(/,/g, "").trim();
	const parsed = Number.parseFloat(cleaned);
	return Number.isFinite(parsed) ? parsed : NaN;
}

function getExcelColumn(row, candidates) {
	const keys = Object.keys(row || {});
	for (const candidate of candidates) {
		const normalized = normalizeKey(candidate);
		const match = keys.find((key) => normalizeKey(key) === normalized);
		if (match) {
			return match;
		}
	}

	return null;
}

function getNativeLandValuesFromRow(row) {
	if (!row) {
		return [];
	}

	const primaryField = getExcelColumn(row, ["Indigenous Territories", "Native Lands", "Native Land", "Territories"]);
	const keys = Object.keys(row);
	const values = [];

	if (primaryField && row[primaryField]) {
		values.push(String(row[primaryField]));
	}

	for (const key of keys) {
		if (!/^__EMPTY/.test(key)) {
			continue;
		}

		const value = String(row[key] ?? "").trim();
		if (value) {
			values.push(value);
		}
	}

	return values
		.flatMap((value) => value.split(/[;,|]/).map((piece) => piece.trim()))
		.filter(Boolean)
		.filter((value, index, array) => array.indexOf(value) === index);
}

function attachNativeLandData(features, rows) {
	const locationField = rows.length ? getExcelColumn(rows[0], ["Location", "ParkName", "Park", "Unit Name"]) : null;
	const avgVisitsField = rows.length ? getExcelColumn(rows[0], ["Average # of visits", "AverageVisits"]) : null;
	const totalVisitsField = rows.length ? getExcelColumn(rows[0], ["Total # Visits", "TotalVisits"]) : null;

	const rowByPark = new Map();
	for (const row of rows) {
		if (!locationField) {
			continue;
		}

		const key = normalizeKey(row[locationField]);
		if (key) {
			rowByPark.set(key, row);
		}
	}

	return features.map((feature) => {
		const parkName = String(feature.properties?.parkName || feature.properties?.NAME || "").trim();
		const matchedRow = rowByPark.get(normalizeKey(parkName));
		const nativeLands = getNativeLandValuesFromRow(matchedRow);

		const averageVisits = matchedRow && avgVisitsField
			? parseNumber(matchedRow[avgVisitsField])
			: parseNumber(feature.properties?.averageVisits);

		const totalVisits = matchedRow && totalVisitsField
			? parseNumber(matchedRow[totalVisitsField])
			: parseNumber(feature.properties?.totalVisits);

		return {
			...feature,
			properties: {
				...feature.properties,
				parkName,
				nativeLands,
				averageVisits: Number.isFinite(averageVisits) ? averageVisits : null,
				totalVisits: Number.isFinite(totalVisits) ? totalVisits : null
			}
		};
	});
}

function filterByNativeLand(features, selectedNativeLand) {
	if (!selectedNativeLand) {
		return features;
	}

	const target = normalizeKey(selectedNativeLand);
	return features.filter((feature) => {
		const nativeLands = feature.properties?.nativeLands || [];
		return nativeLands.some((name) => normalizeKey(name) === target);
	});
}

async function loadJson(path) {
	const response = await fetch(path);
	if (!response.ok) {
		throw new Error(`Failed to load ${path} (${response.status})`);
	}
	return response.json();
}

function normalizeFeatures(geojson) {
	if (!geojson) {
		return [];
	}

	if (geojson.type === "FeatureCollection") {
		return geojson.features || [];
	}

	if (Array.isArray(geojson.geometries)) {
		return geojson.geometries.map((geometry, index) => ({
			type: "Feature",
			geometry,
			properties: { index }
		}));
	}

	return [];
}

function drawParks(features, targetMap, styleOptions) {
	const collection = {
		type: "FeatureCollection",
		features
	};

	const layer = L.geoJSON(collection, {
		style: {
			color: styleOptions.color,
			weight: 2,
			fillColor: styleOptions.fillColor,
			fillOpacity: styleOptions.fillOpacity
		},
		pointToLayer: (feature, latlng) => {
			return L.circleMarker(latlng, {
				radius: 8,
				color: styleOptions.color,
				weight: 2,
				fillColor: styleOptions.fillColor,
				fillOpacity: 0.85
			});
		},
		onEachFeature: (feature, featureLayer) => {
			const name = feature.properties?.parkName || feature.properties?.NAME || "Unknown park";
			const popularity = feature.properties?.averageVisits;
			const totalVisits = feature.properties?.totalVisits;
			const nativeLands = feature.properties?.nativeLands || [];
			const valueText = Number.isFinite(popularity) ? popularity.toLocaleString() : "N/A";
			const totalVisitsText = Number.isFinite(totalVisits) ? totalVisits.toLocaleString() : "N/A";
			const nativeLandsText = nativeLands.length
				? nativeLands.map((land) => escapeHtml(land)).join("<br>")
				: "No Native Land entries in NP_NL.xlsx";

			if (styleOptions.popupMode === "nativeFirst") {
				const nativeTitle = nativeLands.length ? escapeHtml(nativeLands[0]) : "Native Land Not Listed";
				const additionalNative = nativeLands.length > 1
					? `<br>${nativeLands.slice(1).map((land) => escapeHtml(land)).join("<br>")}`
					: "";

				featureLayer.bindPopup(
					`<strong>${nativeTitle}</strong>${additionalNative}<br>` +
					`<small>National Park: ${escapeHtml(name)}</small><br>` +
					`Average visits: ${valueText}<br>` +
					`Total visits: ${totalVisitsText}`
				);
				return;
			}

			featureLayer.bindPopup(
				`<strong>${escapeHtml(name)}</strong><br>` +
				`Average visits: ${valueText}<br>` +
				`Total visits: ${totalVisitsText}<br>` +
				`<strong>Native Lands</strong><br>${nativeLandsText}`
			);
		}
 	}).addTo(targetMap);

	targetMap.fitBounds(layer.getBounds(), { padding: [24, 24] });
}

function renderSummary(features, selectedNativeLand) {
	const container = document.getElementById("summary");
	const items = features
		.map((feature, index) => {
			const name = feature.properties?.parkName || feature.properties?.NAME || `Park ${index + 1}`;
			const averageVisits = feature.properties?.averageVisits;
			const nativeLands = feature.properties?.nativeLands || [];
			const formattedVisits = Number.isFinite(averageVisits)
				? averageVisits.toLocaleString(undefined, { maximumFractionDigits: 2 })
				: "N/A";
			const nativeLandsText = nativeLands.length ? ` - ${escapeHtml(nativeLands.join("; "))}` : "";
			return `<li>${escapeHtml(name)} <span class="rank-value">(${formattedVisits})</span>${nativeLandsText}</li>`;
		})
		.join("");

	const filterMessage = selectedNativeLand
		? `<p>Filtered by Native Land: <strong>${escapeHtml(selectedNativeLand)}</strong></p>`
		: "<p>Showing all parks from NP_NL.xlsx.</p>";

	container.innerHTML = [
		"<h2>Top 10 by popularity</h2>",
		"<p>Loaded from Data/Top10NP.json and connected to Native Lands in Data/NP_NL.xlsx.</p>",
		filterMessage,
		`<ol>${items}</ol>`
	].join("");
}

function renderError(error) {
	const container = document.getElementById("summary");
	container.innerHTML = `<h2>Unable to load data</h2><p>${escapeHtml(error.message || String(error))}</p>`;
	// Keep details in the console for debugging data or path issues.
	console.error("Map initialization failed:", error);
}

function escapeHtml(text) {
	return String(text)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/\"/g, "&quot;")
		.replace(/'/g, "&#39;");
}
