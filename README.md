# MyVC (MySQL Version Control)

Utilities to ease the maintenance of MySQL database versioning using a Git
repository.

## Prerequisites

Required applications.

* Git
* Node.js = 12.17.0 LTS
* Docker

## Installation

It's recommended to install the package globally.
```
# npm install -g myvc
```

## How to use

Export structure (uses production configuration).
```
$ myvc structure
```

Export fixtures (uses production configuration).
```
$ myvc fixtures
```

Export routines.
```
$ myvc routines [environment]
```

Apply changes into database.
```
$ myvc apply [-f] [-u] [environment]
```

## Basic information

Create database connection configuration files for each environment at main
project folder using the standard MySQL parameters. The predefined environment
names are *production* and *testing*.
```
db.[environment].ini
```

Structure and fixture dumps are located inside *dump* folder.

* *structure.sql*
* *fixtures.sql*
* *fixtures.local.sql*

Routines are located inside *routines* folder. It includes procedures,
functions, triggers, views and events with the following structure.
```
  routines
  `- schema
     |- events
     |  `- eventName.sql
     |- functions
     |  `- functionName.sql
     |- procedures
     |  `- procedureName.sql
     |- triggers
     |  `- triggerName.sql
     `- views
        `- viewName.sql
```

## Versions

Place your versions inside *changes* folder with the following structure.
```
  changes
  |- 00001-firstVersionCodeName
  |  |- 00-firstExecutedScript.sql
  |  |- 01-secondScript.sql
  |  `- 99-lastScript.sql
  `- 00002-secondVersion
     |- 00-firstExecutedScript.sql
     `- 00-sameNumbers.sql
```
## Built With

* [Git](https://git-scm.com/)
* [nodejs](https://nodejs.org/)
* [docker](https://www.docker.com/)
