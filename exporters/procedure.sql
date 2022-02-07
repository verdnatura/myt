
SELECT
		`db` AS `schema`,
		`name`,
		`definer`,
		`param_list` AS `paramList`,
		`body`,
		`sql_data_access` AS `dataAccess`,
		`security_type` AS `securityType`,
		`comment`,
		`modified`
	FROM `mysql`.`proc`
	WHERE ? AND `type` = 'PROCEDURE'
	ORDER BY `name`
