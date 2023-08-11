#!/bin/node

require('require-yaml');
const mysql = require('mysql2/promise');
const {fixtures} = require(`${process.cwd()}/myt.config.yml`);

const config = {
  host: 'localhost',
  user: 'root',
  password: 'root'
};

async function connectAndQuery() {
	try {
		const connection = await mysql.createConnection(config);

		// Get schemas

		const [schemaResults] = await connection.query('SHOW DATABASES');
		const schemaNames = schemaResults.map(r => r.Database);

		// Filter system schemas

		const systemSchemas = ['mysql', 'sys', 'information_schema', 'performance_schema'];
		const userSchemas = schemaNames.filter(s => !systemSchemas.includes(s));

		if (userSchemas.length === 0) {
			console.log('There are no user schemas with tables that have records.');
			connection.end();
			return;
		}

		// Get tables with records

		userSchemas.sort((a, b) => a.localeCompare(b));
		for (const schemaName of userSchemas) {
			const [tableResults] = await connection.query(
				`SELECT TABLE_NAME tableName
					FROM information_schema.TABLES
					WHERE TABLE_SCHEMA = ?
						AND TABLE_TYPE <> 'VIEW'`,
				[schemaName]
			);
			const tableNames = tableResults.map(r => r.tableName);
			if (tableNames.length === 0) continue;

			const schemaFixtures = new Set(fixtures[schemaName]);
			const nonEmptyTables = [];

			for (const tableName of tableNames) {
				if (schemaFixtures.has(tableName)) continue;
				try {
					const [[row]] = await connection.query(
						`SELECT COUNT(*) \`count\` FROM ??.??`,
						[schemaName, tableName]
					);
					if (row.count == 0) continue;
					if (!fixtures[schemaName]?.[tableName])
						nonEmptyTables.push(tableName);
				} catch (err) {
					console.error('Error:', err.message);
				}
			}

			nonEmptyTables.sort((a, b) => a.localeCompare(b));
			if (nonEmptyTables.length) {
				console.log(`${schemaName}:`);
				for (const tableName of nonEmptyTables)
					console.log(`  - ${tableName}`);
			}
		}

		connection.end();
	} catch (err) {
		console.error('Error:', err.message);
	}
}

connectAndQuery();
