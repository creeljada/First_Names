const fs = require('fs');
const path = require('path');

const inputPath = path.join(__dirname, 'Data', 'US-National-Parks_RecreationVisits_1979-2024.csv');
const outputPath = path.join(__dirname, 'Data', 'US-National-Parks_AverageVisits_1979-Present.csv');
const startYear = 1979;

const csvText = fs.readFileSync(inputPath, 'utf8');
const rows = parseCsv(csvText);
const filtered = rows.filter((row) => Number.parseInt(row.Year, 10) >= startYear);
const grouped = new Map();

for (const row of filtered) {
	const parkName = row.ParkName.trim();
	const year = Number.parseInt(row.Year, 10);
	const visits = Number.parseInt(String(row.RecreationVisits).replace(/,/g, ''), 10);

	if (!grouped.has(parkName)) {
		grouped.set(parkName, {
			ParkName: parkName,
			Years: new Set(),
			TotalVisits: 0,
			Records: 0
		});
	}

	const aggregate = grouped.get(parkName);
	aggregate.Years.add(year);
	aggregate.TotalVisits += visits;
	aggregate.Records += 1;
}

const results = [...grouped.values()]
	.map((item) => ({
		ParkName: item.ParkName,
		YearsObserved: item.Years.size,
		TotalVisits: item.TotalVisits,
		AverageVisits: roundToTwo(item.TotalVisits / item.Records)
	}))
	.sort((left, right) => right.AverageVisits - left.AverageVisits);

const outputCsv = [
	'ParkName,YearsObserved,TotalVisits,AverageVisits',
	...results.map((row) => [
		csvEscape(row.ParkName),
		row.YearsObserved,
		row.TotalVisits,
		row.AverageVisits.toFixed(2)
	].join(','))
].join('\n');

fs.writeFileSync(outputPath, outputCsv, 'utf8');

console.log(`Wrote ${results.length} park averages to ${outputPath}`);
console.log('Top 10 parks by average annual visits:');
console.table(results.slice(0, 10));

function parseCsv(text) {
	const lines = text.trim().split(/\r?\n/);
	const headers = parseCsvLine(lines.shift()).map((header) => header.replace(/^"|"$/g, ''));

	return lines.map((line) => {
		const values = parseCsvLine(line);
		return headers.reduce((record, header, index) => {
			record[header] = (values[index] ?? '').replace(/^"|"$/g, '');
			return record;
		}, {});
	});
}

function parseCsvLine(line) {
	const values = [];
	let current = '';
	let inQuotes = false;

	for (let index = 0; index < line.length; index += 1) {
		const character = line[index];

		if (character === '"') {
			if (inQuotes && line[index + 1] === '"') {
				current += '"';
				index += 1;
			} else {
				inQuotes = !inQuotes;
			}
			continue;
		}

		if (character === ',' && !inQuotes) {
			values.push(current);
			current = '';
			continue;
		}

		current += character;
	}

	values.push(current);
	return values;
}

function csvEscape(value) {
	const text = String(value);
	return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function roundToTwo(value) {
	return Math.round(value * 100) / 100;
}
