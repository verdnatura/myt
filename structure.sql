
CREATE TABLE `version` (
    `code` VARCHAR(255) NOT NULL,
    `number` CHAR(11) NULL DEFAULT NULL,
    `gitCommit` VARCHAR(255) NULL DEFAULT NULL,
    `updated` DATETIME NOT NULL DEFAULT NULL
) ENGINE=InnoDB;

ALTER TABLE `version`
    ADD PRIMARY KEY (`code`);

CREATE TABLE `versionUser` (
    `code` VARCHAR(255) NOT NULL,
    `user` VARCHAR(255) NOT NULL,
    `number` CHAR(11) NULL DEFAULT NULL,
    `gitCommit` VARCHAR(255) NULL DEFAULT NULL,
    `updated` DATETIME NOT NULL DEFAULT NULL,
    `lastNumber` CHAR(11) NULL DEFAULT NULL,
) ENGINE=InnoDB;

ALTER TABLE `versionUser`
    ADD PRIMARY KEY (`code`,`user`);
