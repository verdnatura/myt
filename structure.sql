
CREATE TABLE `version` (
    `code` VARCHAR(50) NOT NULL,
    `number` CHAR(11) NULL DEFAULT NULL,
    `gitCommit` VARCHAR(255) NULL DEFAULT NULL,
    `updated` DATETIME NOT NULL,
    `lastNumber` CHAR(11) NULL DEFAULT NULL
) ENGINE=InnoDB;

ALTER TABLE `version`
    ADD PRIMARY KEY (`code`);

CREATE TABLE `versionLog` (
    `code` VARCHAR(50) NOT NULL,
    `number` CHAR(11) NOT NULL,
    `file` VARCHAR(255) NOT NULL,
    `user` VARCHAR(255) NULL,
    `updated` DATETIME NOT NULL,
    `errorNumber` INT(10) UNSIGNED DEFAULT NULL,
    `errorMessage` VARCHAR(255) DEFAULT NULL
) ENGINE=InnoDB;

ALTER TABLE `versionLog`
    ADD PRIMARY KEY (`code`,`number`,`file`);
