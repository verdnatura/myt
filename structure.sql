
CREATE TABLE `version` (
    `code` varchar(255) NOT NULL,
    `number` char(11) NULL DEFAULT NULL,
    `gitCommit` varchar(255) NULL DEFAULT NULL,
    `updated` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

ALTER TABLE `version`
    ADD PRIMARY KEY (`code`);

CREATE TABLE `versionUser` (
    `code` varchar(255) NOT NULL,
    `user` varchar(255) NOT NULL,
    `number` char(11) NULL DEFAULT NULL,
    `gitCommit` varchar(255) NULL DEFAULT NULL,
    `updated` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

ALTER TABLE `versionUser`
    ADD PRIMARY KEY (`code`,`user`);
