
SELECT
		TABLE_NAME `name`,
		VIEW_DEFINITION `definition`,
		CHECK_OPTION `checkOption`,
		IS_UPDATABLE `isUpdatable`,
		DEFINER `definer`,
		SECURITY_TYPE `securityType`
	FROM information_schema.VIEWS
		WHERE TABLE_SCHEMA = ?
