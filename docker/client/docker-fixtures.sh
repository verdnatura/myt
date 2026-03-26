#!/bin/bash

# FIXME: It can corrupt data
# Currently not used, instead mysqldump --skip-extended-insert option is used
mysqldump $@ | sed -E 's/(VALUES |\),)\(/\1\n\t\(/g'
