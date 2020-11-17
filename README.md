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
$ myvc [command]
```

You can also install locally and use the *npx* command to execute it.

```text
$ npm install myvc
$ npx myvc [command]
```

## How to use

Execute *myvc* with the desired command.

```text
$ myvc [-w|--workspace] [-e|--env] [-h|--help] command
```

The default working directory is the current one and unless otherwise indicated,
the default environment is *production*.

Commands for database versioning:

 * **pull**: Exports database routines into workspace.
 * **push**: Apply changes into database, uses *test* environment by default.

Commands for local server management:

 * **dump**: Export database structure and fixtures.
 * **run**: Builds and starts local database server container.
 * **start**: Starts local database server container.

Each command can have its own specific commandline options.

## Basic information

First of all you have to import *structure.sql* into your database. This script
includes the tables where MyVC stores information about applied versions.

Create *myvc.config.json* main configuration file at the root of your project 
folder, this file should include the project codename and schemas/tables wich 
are exported when you use *pull* or *dump* commands. You have an example of a 
configuration file in the root folder of this project.

### Environments

Create database connection configuration files for each environment at main 
project folder using standard MySQL *.ini*. The predefined environment names 
are *production* and *testing*.

```text
db.[environment].ini
```

### Dumps

Structure and fixture dumps will be created into hidden file *.dump.sql*. You
can also create your local fixture and structure files.

* *myvc.structure.sql*
* *myvc.fixtures.sql*

### Routines

Routines should be placed inside *routines* folder. All objects that have
PL/SQL code are considered routines. It includes events, functions, procedures,
triggers and views with the following structure.

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
!Don't place your PL/SQL objects here, use the routines folder!

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

### Local server

The local server will be created as a MariaDB Docker container using the base
dump created with the *dump* command plus pushing local versions and changed
routines.

## Why

The main reason for starting this project it's because there are no fully free 
and opensource migration tools available that allow versioning database routines
with an standard CVS system as if they were normal application code.

Also, the existing tools are too complex and require too much knowledge to start
a small project.

## Todo

Improve the pull command to, instead of completely overwriting the routines
directory, merge the database changes with the local SQL files. It is possible
using a library that allows to manipulate git repositories (nodegit) and running
the following steps:

1. Save the current HEAD.
2. Check out to the last database push commit (saved in versioning tables).
3. Create and checkout to a new branch.
4. Export database routines.
5. Commit the new changes.
5. Checkout to the original HEAD.
6. Merge the new branch into.
7. Let the user deal with merge conflicts.

Furthermore, migrate all possible tools and code from shell scripts to native
Javascript, dealing with dependencies and compatibility issues between various
OS that this may cause.

## Built With

* [Git](https://git-scm.com/)
* [nodejs](https://nodejs.org/)
* [docker](https://www.docker.com/)
