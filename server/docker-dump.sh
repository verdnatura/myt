#!/bin/bash

# FIXME: It can corrupt data
mysqldump $@ | sed 's/ AUTO_INCREMENT=[0-9]* //g'
