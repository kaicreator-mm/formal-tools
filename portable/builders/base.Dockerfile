# ft-builder:deb13 — builder image for portable tool builds.
# Builder-only (has network); nothing here ships into the portable bundle.
FROM debian:13

ENV DEBIAN_FRONTEND=noninteractive

# deb.debian.org is unreachable from the build network; use USTC mirror
RUN printf 'deb http://mirrors.ustc.edu.cn/debian trixie main\ndeb http://mirrors.ustc.edu.cn/debian-security trixie-security main\n' > /etc/apt/sources.list \
    && rm -f /etc/apt/sources.list.d/debian.sources

RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl wget xz-utils zstd unzip bzip2 file binutils patchelf \
        build-essential cmake ninja-build pkg-config git autoconf automake libtool m4 \
        python3 python3-pip python3-dev \
        zlib1g-dev libssl-dev libffi-dev libsqlite3-dev libbz2-dev liblzma-dev \
        uuid-dev libreadline-dev libncurses-dev libgdbm-dev libgdbm-compat-dev \
        openjdk-21-jdk-headless \
        flex bison re2c \
        ocaml ocaml-findlib menhir libnum-ocaml-dev \
        texinfo \
    && rm -rf /var/lib/apt/lists/*
