
SELECT
		`db` AS `schema`,
		`name`,
		`definer`,
		`param_list` AS `paramList`,
		`returns`,
		`is_deterministic` AS `isDeterministic`,
		`body`,
		`modified`
	FROM `mysql`.`proc`
	WHERE ? AND `type` = 'FUNCTION'
	ORDER BY `name`
