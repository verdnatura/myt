
CREATE DATABASE IF NOT EXISTS `util` DEFAULT CHARACTER SET utf8 COLLATE utf8_unicode_ci;
USE `util`;

CREATE TABLE `version` (
    `code` varchar(255) COLLATE utf8_unicode_ci NOT NULL,
    `number` char(11) COLLATE utf8_unicode_ci NOT NULL,
    `gitCommit` varchar(255) COLLATE utf8_unicode_ci NOT NULL,
    `updated` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

ALTER TABLE `version`
    ADD PRIMARY KEY (`code`);

CREATE TABLE `versionUser` (
    `code` varchar(255) COLLATE utf8_unicode_ci NOT NULL,
    `user` varchar(255) COLLATE utf8_unicode_ci NOT NULL,
    `number` char(11) COLLATE utf8_unicode_ci NOT NULL,
    `gitCommit` varchar(255) COLLATE utf8_unicode_ci NOT NULL,
    `updated` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8 COLLATE=utf8_unicode_ci;

ALTER TABLE `versionUser`
    ADD PRIMARY KEY (`code`,`user`);
