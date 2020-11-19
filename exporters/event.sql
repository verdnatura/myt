
SELECT 
		EVENT_NAME `name`,
		DEFINER `definer`,
		EVENT_DEFINITION `body`,
		EVENT_TYPE `type`,
		EXECUTE_AT `execute_at`,
		INTERVAL_VALUE `intervalValue`,
		INTERVAL_FIELD `intervalField`,
		STARTS `starts`,
		ENDS `ends`,
		STATUS `status`,
		ON_COMPLETION `onCompletion`,
		EVENT_COMMENT `comment`,
		LAST_ALTERED `modified`
	FROM information_schema.EVENTS
		WHERE EVENT_SCHEMA = ?
