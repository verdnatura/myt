
SELECT
		`TABLE_SCHEMA` AS `schema`,
		`TABLE_NAME` AS `name`,
		`VIEW_DEFINITION` AS `definition`,
		`CHECK_OPTION` AS `checkOption`,
		`IS_UPDATABLE` AS `isUpdatable`,
		`DEFINER` AS `definer`,
		`SECURITY_TYPE` AS `securityType`
	FROM `information_schema`.`VIEWS`
	WHERE ?
	ORDER BY `name`
