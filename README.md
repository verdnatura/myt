# MyVC (MySQL Version Control)

Utilities to ease the maintenance of MySQL or MariaDB database versioning using
a Git repository.

This project is just to bring an idea to life and is still in an early stage of
development, so it may not be fully functional.

Any help is welcomed! Feel free to contribute.

## Prerequisites

Required applications.

* Node.js = 12.17.0 LTS
* Git
* Docker

## Installation

It's recommended to install the package globally.
```text
# npm install -g myvc
```

You can also install locally and use the *npx* command to execute it.
```text
$ npm install myvc
$ npx myvc [action]
```

## How to use

Execute *myvc* with the desired action.
```text
$ myvc [-w|--workdir] [-e|--env] [-h|--help] action
```
The default working directory is the current one and unless otherwise indicated,
the default environment is *production*.

Available actions are:
 * **structure**: Export the database structure.
 * **fixtures**: Export the database structure.
 * **routines**: Export database routines.
 * **apply**: Apply changes into database, uses *local* environment by default.
 * **run**: Builds and starts local database server container.
 * **start**: Starts local database server container.

Each action can have its own specific commandline options.

## Basic information

Create database connection configuration files for each environment at main
project folder using the standard MySQL *.ini* parameters. The predefined
environment names are *production* and *testing*.
```text
db.[environment].ini
```

Structure and fixture dumps will be created inside *dump* folder.

* *structure.sql*
* *fixtures.sql*
* *fixtures.local.sql*

### Routines

Routines should be placed inside *routines* folder. All objects that have
PL/SQL code are considered routines. It includes functions, triggers, views and 
events with the following structure.
```text
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

### Versions

Versions should be placed inside *changes* folder with the following structure.
```text
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
