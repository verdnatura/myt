
SELECT
		`db` AS `schema`,
		`name`,
		`definer`,
		`param_list` AS `paramList`,
		`body`,
		`modified`
	FROM `mysql`.`proc`
	WHERE ? AND `type` = 'PROCEDURE'
	ORDER BY `name`
