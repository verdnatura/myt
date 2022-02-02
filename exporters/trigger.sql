
SELECT
		`TRIGGER_SCHEMA` AS `schema`,
		`TRIGGER_NAME` AS `name`,
		`DEFINER` AS `definer`,
		`ACTION_TIMING` AS `actionTiming`,
		`EVENT_MANIPULATION` AS `actionType`,
		`EVENT_OBJECT_TABLE` AS `table`,
		`ACTION_STATEMENT` AS `body`,
		`CREATED` AS `modified`
	FROM `information_schema`.`TRIGGERS`
	WHERE ?
	ORDER BY `name`
