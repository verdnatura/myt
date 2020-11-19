
SELECT
		`name`,
		`definer`,
		`param_list` paramList,
		`body`,
		`modified`
	FROM mysql.proc
		WHERE db = ? AND type = 'PROCEDURE'
