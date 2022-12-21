#!/bin/bash

# FIXME: It can corrupt data
mysqldump $@ | sed -E 's/(VALUES |\),)\(/\1\n\t\(/g'
