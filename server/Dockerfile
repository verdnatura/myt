FROM mariadb:10.7.3

ENV MYSQL_ROOT_PASSWORD root

ARG DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        curl \
    && curl -sL https://deb.nodesource.com/setup_14.x | bash - \
    && apt-get install -y --no-install-recommends \
        nodejs \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir /mysql-data \
    && chown -R mysql:mysql /mysql-data

WORKDIR /myvc

COPY \
    package.json \
    ./
RUN npm install --only=prod

COPY \
    structure.sql \
    myvc.js \
    myvc-push.js \
    lib.js \
    docker.js \
    myvc.default.yml \
    db.ini \
    ./
COPY exporters exporters
RUN ln -s /myvc/myvc.js /usr/local/bin/myvc

WORKDIR /workspace

COPY server/docker.cnf /etc/mysql/conf.d/
COPY \
    server/docker-init.sh \
    server/docker-temp-start.sh \
    server/docker-temp-stop.sh \
    server/docker-dump.sh \
    server/docker-start.sh \
    /usr/local/bin/

ENTRYPOINT ["docker-start.sh"]

CMD ["mysqld"]

HEALTHCHECK --interval=2s --timeout=10s --retries=200 \
    CMD mysqladmin ping -h 127.0.0.1 -u root --password=root || exit 1
