
SELECT
		`name`,
		`definer`,
		`param_list` AS `paramList`,
		`body`,
		`modified`
	FROM `mysql`.`proc`
	WHERE `db` = ? AND `type` = 'PROCEDURE'
	ORDER BY `name`
