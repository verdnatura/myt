ARG MYT_TAG=myt/app
ARG BASE_TAG=myt/base

FROM ${MYT_TAG} AS dump

ARG ROOT_PASS
ENV ROOT_PASS=${ROOT_PASS}

RUN mkdir -p /mysql-template \
    && chown mysql:mysql /mysql-template

WORKDIR /workspace
COPY . .

ARG MYT_REALM
ARG MYT_COMMIT
RUN --mount=type=tmpfs,target=/var/lib/mysql \
    chown mysql:mysql /var/lib/mysql \
    && gosu mysql docker-init.sh

FROM ${BASE_TAG}

COPY --from=dump --chown=mysql:mysql \
    /mysql-template /mysql-template

ENTRYPOINT ["docker-start.sh"]
CMD ["mariadbd"]

HEALTHCHECK --interval=2s --timeout=10s --retries=200 \
    CMD gosu mysql mariadb-admin ping || exit 1
