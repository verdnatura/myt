
SELECT
		`db` AS `schema`,
		`name`,
		`definer`,
		`param_list` AS `paramList`,
		`body`,
		`sql_data_access` AS `dataAccess`,
		`security_type` AS `securityType`,
		`comment`,
		`modified`,
		`is_deterministic` AS `isDeterministic`,
		`returns`
	FROM `mysql`.`proc`
	WHERE ? AND `type` = 'FUNCTION'
	ORDER BY `name`
