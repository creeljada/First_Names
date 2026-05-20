const SHAPEFILE_PATH = "Data/Pop_NP/Top10NP.shp";
const TOP_COUNT = 10;

const map = L.map("map", {
	zoomControl: true,
	scrollWheelZoom: true
}).setView([39.5, -98.35], 4);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
	maxZoom: 19,
	attribution: "&copy; OpenStreetMap contributors"
}).addTo(map);

initialize();

async function initialize() {
	try {
		if (typeof shp !== "function") {
			throw new Error("shpjs did not load.");
		}

		const geojson = await shp(SHAPEFILE_PATH);
		const features = normalizeFeatures(geojson);

		if (!features.length) {
			throw new Error("No features were found in the Pop_NP dataset.");
		}

		const popularityField = detectPopularityField(features[0].properties || {});
		const nameField = detectNameField(features[0].properties || {});

		if (!popularityField) {
			throw new Error("Could not detect a popularity field in the shapefile attributes.");
		}

		const ranked = features
			.map((feature) => ({
				feature,
				name: String(feature.properties?.[nameField] ?? "Unknown park"),
				popularity: parseNumber(feature.properties?.[popularityField])
			}))
			.filter((item) => Number.isFinite(item.popularity))
			.sort((a, b) => b.popularity - a.popularity)
			.slice(0, TOP_COUNT);

		drawParks(ranked);
		renderSummary(ranked, popularityField);
	} catch (error) {
		renderError(error);
	}
}

function normalizeFeatures(geojson) {
	if (!geojson) {
		return [];
	}

	if (geojson.type === "FeatureCollection") {
		return geojson.features || [];
	}

	if (Array.isArray(geojson)) {
		return geojson.flatMap((entry) => {
			if (entry?.type === "FeatureCollection") {
				return entry.features || [];
			}
			return [];
		});
	}

	return [];
}

function detectPopularityField(properties) {
	const keys = Object.keys(properties);
	const preferred = [
		"AverageVisits",
		"AvgVisits",
		"TotalVisits",
		"Visits",
		"POPULARITY",
		"Pop",
		"popularity"
	];

	for (const field of preferred) {
		const match = keys.find((key) => key.toLowerCase() === field.toLowerCase());
		if (match) {
			return match;
		}
	}

	const numericGuess = keys.find((key) => {
		const value = properties[key];
		return Number.isFinite(parseNumber(value));
	});

	return numericGuess || null;
}

function detectNameField(properties) {
	const keys = Object.keys(properties);
	const preferred = ["ParkName", "NAME", "Name", "Park", "UNIT_NAME", "UNITNAME"];

	for (const field of preferred) {
		const match = keys.find((key) => key.toLowerCase() === field.toLowerCase());
		if (match) {
			return match;
		}
	}

	return keys[0] || "name";
}

function parseNumber(value) {
	if (typeof value === "number") {
		return value;
	}

	const cleaned = String(value ?? "").replace(/,/g, "").trim();
	const parsed = Number.parseFloat(cleaned);
	return Number.isFinite(parsed) ? parsed : NaN;
}

function drawParks(ranked) {
	const collection = {
		type: "FeatureCollection",
		features: ranked.map((item) => ({
			...item.feature,
			properties: {
				...item.feature.properties,
				__displayName: item.name,
				__displayPopularity: item.popularity
			}
		}))
	};

	const layer = L.geoJSON(collection, {
		style: {
			color: "#084c61",
			weight: 2,
			fillColor: "#2fa8c6",
			fillOpacity: 0.45
		},
		pointToLayer: (feature, latlng) => {
			return L.circleMarker(latlng, {
				radius: 8,
				color: "#0f4c5c",
				weight: 2,
				fillColor: "#2fa8c6",
				fillOpacity: 0.85
			});
		},
		onEachFeature: (feature, featureLayer) => {
			const name = feature.properties?.__displayName || "Unknown park";
			const popularity = feature.properties?.__displayPopularity;
			const valueText = Number.isFinite(popularity) ? popularity.toLocaleString() : "N/A";
			featureLayer.bindPopup(`<strong>${escapeHtml(name)}</strong><br>Popularity: ${valueText}`);
		}
	}).addTo(map);

	map.fitBounds(layer.getBounds(), { padding: [24, 24] });
}

function renderSummary(ranked, popularityField) {
	const container = document.getElementById("summary");
	const items = ranked
		.map((item, index) => `<li>${index + 1}. ${escapeHtml(item.name)} <span class="rank-value">(${item.popularity.toLocaleString()})</span></li>`)
		.join("");

	container.innerHTML = [
		"<h2>Top 10 by popularity</h2>",
		`<p>Using attribute field: <strong>${escapeHtml(popularityField)}</strong></p>`,
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
