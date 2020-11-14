FROM mariadb:10.4.13

ENV MYSQL_ROOT_PASSWORD root
ENV TZ Europe/Madrid

ARG DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl ca-certificates \
    && curl -sL https://apt.verdnatura.es/conf/verdnatura.gpg | apt-key add - \
    && echo "deb http://apt.verdnatura.es/ jessie main" > /etc/apt/sources.list.d/vn.list \
    && apt-get update \
    && apt-get install -y vn-mariadb \
    && apt-get purge -y --auto-remove curl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY docker/docker.cnf /etc/mysql/conf.d/
COPY \
    docker/docker-init.sh \
    docker/docker-temp-start.sh \
    docker/docker-temp-stop.sh \
    docker/docker-dump.sh \
    docker/docker-start.sh \
    /usr/local/bin/

RUN mkdir /mysql-data \
    && chown -R mysql:mysql /mysql-data

WORKDIR /docker-boot

COPY \
    import-changes.sh \
    db.ini \
    dump/structure.local.sql \
    dump/structure.sql \
    dump/fixtures.sql \
    ./
RUN gosu mysql docker-init.sh \
    && docker-dump.sh structure.local \
    && docker-dump.sh structure \
    && docker-dump.sh fixtures \
    && gosu mysql docker-temp-stop.sh

COPY changes ./changes
COPY dump/fixtures.local.sql ./
ARG STAMP=unknown
RUN gosu mysql docker-temp-start.sh \
    && ./import-changes.sh \
    && docker-dump.sh fixtures.local \
    && gosu mysql docker-temp-stop.sh

RUN echo "[INFO] -> Import finished" \
    && rm -rf /docker-boot

USER mysql
ENTRYPOINT ["docker-start.sh"]

CMD ["mysqld"]

HEALTHCHECK --interval=2s --timeout=10s --retries=200 \
    CMD mysqladmin ping -h 127.0.0.1 -u root --password=root || exit 1
