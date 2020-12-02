#!/bin/bash

mysqldump $@ | sed 's/ AUTO_INCREMENT=[0-9]* //g'
