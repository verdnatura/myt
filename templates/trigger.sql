
SELECT
		TRIGGER_NAME `name`,
		DEFINER `definer`,
		ACTION_TIMING `actionTiming`,
		EVENT_MANIPULATION `actionType`,
		EVENT_OBJECT_TABLE `table`,
		ACTION_STATEMENT `body`,
		CREATED `modified`
	FROM information_schema.TRIGGERS
		WHERE TRIGGER_SCHEMA = ?
