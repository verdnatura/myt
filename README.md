# Myt - MySQL version control

Utilities to ease the maintenance of MySQL or MariaDB database versioning using
a Git repository.

This project is just to bring an idea to life and is still in an early stage of
development, so any help is welcomed! Feel free to contribute.

## Requirements

* Git
* Docker (Optional, used to manage local server)

## Installation

Required libraries to build with *node-gyp*.
```text
# apt install libkrb5-dev libssl-dev
```

It's recommended to install the package globally.

```text
# npm install -g @verdnatura/myt
$ myt <command>
```

You can also install locally and use the *npx* command to execute it.

```text
$ npm install @verdnatura/myt
$ npx myt <command>
```

## How to use

Execute *myt* with the desired command.

```text
$ [npx] myt [-w|--workspace <string>] [-r|--remote <string>] [-d|--debug]
[-h|--help] <command> [<args>]
```

The default workspace directory is the current working directory and unless 
otherwise indicated, the default remote is *local*.

Database versioning commands:

 * **init**: Initialize an empty workspace.
 * **pull**: Incorporate database routine changes into workspace.
 * **push**: Apply changes into database.
 * **version**: Creates a new version.
 * **create**: Creates a new routine file.
 * **clean**: Cleans old versions.

Local server management commands:

 * **dump**: Export database structure and fixtures.
 * **fixtures**: Export local database fixtures.
 * **run**: Build and start local database server container.
 * **start**: Start local database server container.

Each command can have its own specific commandline options.

## Basic information

First of all you have to initialize the workspace.

```text
$ myt init
```

Now you can configure Myt using *myt.config.yml* file, located at the root of
your workspace. This file should include the project codename and schemas/tables
which are exported when you use *pull* or *dump* commands.

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
$ myt pull production
```

From now on, you can use the project as if it were a standard git repository
(since it is). To apply changes to the database run the *push* command on the
desired remote.

```text
$ myt push [<remote>] [--commit]
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

### Environment-Specific Versioning with Realms

#### Overview

We have introduced a new feature that allows users to apply version-specific changes based on their configured environment, or "realm". This ensures that certain changes are only applied when the user is operating within a specific realm, providing an additional layer of customization and control.

#### Configuration

To make use of this feature, you need to configure your realm in the `versionConfig` table. Set your realm by inserting or updating a record in this table. The `realm` field should contain the identifier of your environment.

#### File Naming Convention

To designate a file as realm-specific, include a `.your_realm.` segment before the file extension. For example, if your realm is set to 'ab', the file should be named like this: `filename.ab.sql`.

#### How It Works

1. **Set your Realm**: Configure your realm in the `versionConfig` table.
  
2. **Add Files**: Place your realm-specific files in the `versions` folder. Make sure to follow the naming convention.

3. **Version Order**: Files are applied in the existing version order. In addition to that, the realm is validated.

4. **Apply Changes**: Run the usual versioning commands. The realm-specific files will only be applied if your configured realm matches the realm in the file name.

#### Important Notes

- If no realm is configured, realm-specific files will be ignored.
  
- If you have a realm configured but the realm-specific files belong to a different realm, those files will also be ignored.

This feature allows for greater flexibility when working in different environments, making it easier to manage realm-specific changes in a shared repository.

### Local server

The local server is created as a MariaDB Docker container using the base dump 
created with the *dump* command plus pushing local versions and changed 
routines.

### Dumps

You can create your local fixture and structure files.

* *dump/dump.before.sql*
* *dump/dump.after.sql*
* *dump/fixtures.before.sql*
* *dump/fixtures.after.sql*
* *dump/fixtures.local.sql*

## Versioning commands

### init

Initializes an empty workspace.

```text
$ myt init
```


### pull

Incorporates database routine changes into workspace.

```text
$ myt pull [remote] [-f|--force] [-c|--checkout] [-u|--update] [-s|--sums]
```

When *--checkout* option is provided, it does the following before export:

1. Get the last database push commit (saved in versioning tables).
2. Creates and checkout to a new branch based in database commit.

### push

Applies versions and routine changes into database.

```text
$ myt push [<remote>] [-f|--force] [-c|--commit] [-s|--sums] [-t|--triggers]
```

Commit is saved into database only if *--commit* option is provided, it
prevents from accidentally saving local commits into shared servers, causing 
subsequent pushes from other clients to fail because they can't get that 
commit from the git tree in order to get differences.

### version

Creates a new version folder, when name is not specified it generates a random 
name mixing a color with a plant name.

```text
$ myt version [<name>]
```

### create

Creates a new routine file with a default template.

```text
$ myt create [-t <type>] <schema>.<name>
```

### clean

Cleans all already applied versions older than  *maxOldVersions*.

```text
$ myt clean [-p|--purge]
```

## Local server commands

### dump

Exports database structure and fixtures from remote into hidden files located
in *dump* folder. If no remote is specified *production* is used.

```text
$ myt dump [<remote>] [-l|--lock] [-t|--triggers]
```

### fixtures

Exports local database fixtures into *dump/fixtures.sql* files. If no remote is
specified *local* is used.

```text
$ myt fixtures [<remote>]
```

### run

Builds and starts local database server container. It only rebuilds the image 
dump has been modified.

```text
$ myt run [-c|--ci] [-r|--random]
```

### start

Starts local database server container. It does the minium effort, if it 
doesn't exists calls the run command, if it is started does nothing. Keep in 
mind that when you do not rebuild the docker you may be using an outdated 
version of it.

```text
$ myt start
```

## Why

The main reason for starting this project is because there are no fully free 
and open source migration tools available that allow versioning database 
routines with a standard CVS system as if they were normal application code.

Also, the existing tools are too complex and require too much knowledge to 
initiate a small project.

## To-Do

* Undo changes when there is an error applying a version using "undo" files.
* Console logging via events.
* Lock version table row when pushing.
* Preserve all characteristics on pull: SQL mode, character set, algorithm...

## Built With

* [Git](https://git-scm.com/)
* [Node.js](https://nodejs.org/)
* [NodeGit](https://www.nodegit.org/)
* [Docker](https://www.docker.com/)
