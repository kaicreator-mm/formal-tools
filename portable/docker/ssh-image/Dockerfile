# formal-tools SSH service image — Debian 13 (trixie) x86_64 with the full
# portable tools bundle + SSH access using the build server's account/key.
# Build context must contain the assembled bundle at ./formal-tools-portable-debian13-x86_64
# and cc-authorized_keys (public key(s) authorized for cc@<build-server>).
FROM debian:13

ENV DEBIAN_FRONTEND=noninteractive

RUN printf 'deb http://mirrors.ustc.edu.cn/debian trixie main\ndeb http://mirrors.ustc.edu.cn/debian-security trixie-security main\n' > /etc/apt/sources.list \
    && rm -f /etc/apt/sources.list.d/debian.sources \
    && apt-get update && apt-get install -y --no-install-recommends \
        openssh-server bash ca-certificates tzdata \
    && rm -rf /var/lib/apt/lists/*

# account mirrors the build server user (uid 1000), same authorized_keys
COPY cc-authorized_keys /tmp/cc-authorized_keys
RUN useradd -m -u 1000 -s /bin/bash cc \
    && mkdir -p /home/cc/.ssh /run/sshd \
    && install -m 600 -o cc -g cc /tmp/cc-authorized_keys /home/cc/.ssh/authorized_keys \
    && rm /tmp/cc-authorized_keys \
    && echo 'cc soft nofile 4096' > /etc/security/limits.d/cc.conf

# bundle: extracted, world-readable, writable evidence dir for cc
COPY formal-tools-portable-debian13-x86_64 /opt/formal-tools-portable-debian13-x86_64
RUN ln -sf /opt/formal-tools-portable-debian13-x86_64 /home/cc/formal-tools \
    && mkdir -p /opt/formal-tools-portable-debian13-x86_64/evidence \
    && chown -R cc:cc /opt/formal-tools-portable-debian13-x86_64/evidence /home/cc
# why3's compiled-in libdir is an absolute Debian path; at this fixed install path we
# can link the shipped tree so `why3 prove` works fully for the cc account
RUN mkdir -p /usr/lib/x86_64-linux-gnu/ocaml \
    && ln -sfn /opt/formal-tools-portable-debian13-x86_64/tools/why3/usr/lib/x86_64-linux-gnu/ocaml/5.3.0 \
         /usr/lib/x86_64-linux-gnu/ocaml/5.3.0

# sshd: public-key only
RUN sed -i \
      -e 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' \
      -e 's/^#\?PermitRootLogin.*/PermitRootLogin no/' \
      -e 's/^#\?PubkeyAuthentication.*/PubkeyAuthentication yes/' \
      /etc/ssh/sshd_config \
    && ssh-keygen -A

EXPOSE 22
# login shell hint: bundle runner at ~/formal-tools/bin/tool-runner
CMD ["/usr/sbin/sshd", "-D", "-e"]
