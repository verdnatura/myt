
SELECT
		`name`,
		`definer`,
		`param_list` paramList,
		`returns`,
		`is_deterministic` isDeterministic,
		`body`,
		`modified`
	FROM mysql.proc
		WHERE `db` = ? AND `type` = 'FUNCTION'
