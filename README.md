# MyVC (MySQL Version Control)

Utilities to ease the maintenance of MySQL or MariaDB database versioning using
a Git repository.

This project is just to bring an idea to life and is still in an early stage of
development, so any help is welcomed! Feel free to contribute.

## Requirements

* Node.js >= 14.0
* Git
* Docker (Local server)

## Installation

It's recommended to install the package globally.

```text
# npm install -g myvc
$ myvc <command>
```

You can also install locally and use the *npx* command to execute it.

```text
$ npm install myvc
$ npx myvc <command>
```

## How to use

Execute *myvc* with the desired command.

```text
$ [npx] myvc [-w|--workspace <string>] [-r|--remote <string>] [-d|--debug] [-h|--help] <command> [<args>]
```

The default workspace directory is the current working directory and unless 
otherwise indicated, the default remote is *local*.

Database versioning commands:

 * **init**: Initialize an empty workspace.
 * **pull**: Incorporate database routine changes into workspace.
 * **push**: Apply changes into database.
 * **version**: Creates a new version.

Local server management commands:

 * **dump**: Export database structure and fixtures.
 * **run**: Build and start local database server container.
 * **start**: Start local database server container.

Each command can have its own specific commandline options.

## Basic information

First of all you have to initalize the workspace.

```text
$ myvc init
```

Now you can configure MyVC using *myvc.config.yml* file, located at the root of
your workspace. This file should include the project codename and schemas/tables
wich are exported when you use *pull* or *dump* commands.

Don't forget to initialize git (if it isn't initialized yet).

```text
$ git init
```

### Remotes

Create database connection configuration for each environment at *remotes*
folder using standard MySQL *ini* configuration files. The convention remote
names are *local*, *production* and *test*.

```text
remotes/[remote].ini
```
### Startup

Once the basic configuration is done, routines can be imported from the
database into the project, it is recommended to use the *production* remote.

```text
$ myvc pull production
```

From now on, you can use the project as if it were a standard git repository
(since it is). To apply changes to the database run the *push* command on the
desired remote.

```text
$ myvc push [<remote>] [--save-commit]
```

### Routines

Routines are placed inside *routines* folder. All objects that have PL/SQL code 
are considered routines. It includes events, functions, procedures, triggers 
and views with the following structure.

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

Versions are placed inside *versions* folder with the following structure.
Don't place your PL/SQL objects here, use the routines folder!

```text
  versions
  |- 00001-firstVersionCodeName
  |  |- 00-firstExecutedScript.sql
  |  |- 01-secondScript.sql
  |  `- 99-lastScript.sql
  `- 00002-secondVersion
     |- 00-firstExecutedScript.sql
     `- 00-sameNumbers.sql
```

### Local server

The local server is created as a MariaDB Docker container using the base dump 
created with the *dump* command plus pushing local versions and changed 
routines.

### Dumps

You can create your local fixture and structure files.

* *dump/structure.sql*
* *dump/fixtures.sql*


## Versioning commands

### init

Initializes an empty workspace.

```text
$ myvc init
```

### pull

Incorporates database routine changes into workspace.

```text
$ myvc pull [remote] [-f|--force] [-c|--checkout] [-u|--update] [-s|--sums]
```

When *--checkout* option is provided, it does the following before export:

1. Get the last database push commit (saved in versioning tables).
2. Creates and checkout to a new branch based in database commit.

### push

Applies versions and routine changes into database.

```text
$ myvc push [<remote>] [-f|--force] [-c|--commit] [-s|--sums]
```

Commit is saved into database only if *--commit* option is provided, it
prevents from accidentally saving local commits into shared servers, causing 
subsequent pushes from other clients to fail because they can't get that 
commit from the git tree in order to get differences.

### version

Creates a new version folder, when name is not specified it generates a random 
name mixing a color with a plant name.

```text
$ myvc version [<name>] [-o|--hold]
```

## Local server commands

### dump

Exports database structure and fixtures from remote into hidden files located
in *dump* folder. If no remote is specified *production* is used.

```text
$ myvc dump [<remote>]
```

### run

Builds and starts local database server container. It only rebuilds the image 
when fixtures have been modified or when the day on which the image was built 
is different to today.

```text
$ myvc run [-c|--ci] [-r|--random]
```

### start

Starts local database server container. It does the minium effort, if it 
doesn't exists calls the run command, if it is started does nothing. Keep in 
mind that when you do not rebuild the docker you may be using an outdated 
version of it.

```text
$ myvc start
```

## Why

The main reason for starting this project it's because there are no fully free 
and open source migration tools available that allow versioning database 
routines with an standard CVS system as if they were normal application code.

Also, the existing tools are too complex and require too much knowledge to 
start a small project.

## Todo

* Undo changes when there is an error applying a version using "undo" files.
* Use a custom *Dockerfile* for local database container.
* Console logging via events.
* Lock version table row when pushing.
* Preserve all characteristics on pull: SQL mode, character set, algorithm...

## Built With

* [Git](https://git-scm.com/)
* [nodejs](https://nodejs.org/)
* [NodeGit](https://www.nodegit.org/)
* [docker](https://www.docker.com/)
