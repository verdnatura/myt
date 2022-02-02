
SELECT 
		`EVENT_SCHEMA` AS `schema`,
		`EVENT_NAME` AS `name`,
		`DEFINER` AS `definer`,
		`EVENT_DEFINITION` AS `body`,
		`EVENT_TYPE` AS `type`,
		`EXECUTE_AT` AS `execute_at`,
		`INTERVAL_VALUE` AS `intervalValue`,
		`INTERVAL_FIELD` AS `intervalField`,
		`STARTS` AS `starts`,
		`ENDS` AS `ends`,
		`STATUS` AS `status`,
		`ON_COMPLETION` AS `onCompletion`,
		`EVENT_COMMENT` AS `comment`,
		`LAST_ALTERED` AS `modified`
	FROM `information_schema`.`EVENTS`
	WHERE ?
	ORDER BY `name`
