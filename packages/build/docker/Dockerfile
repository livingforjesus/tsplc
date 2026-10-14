# Build with --platform=linux/amd64; CODESYS and its CLR are x86-64.
ARG SETUP_BASE=base
ARG SETUP_PLATFORM=linux/amd64
ARG INSTALLER_SOURCE=installer-download
FROM oven/bun:1.4.3 AS bun

FROM ubuntu:24.04 AS tools
ENV DEBIAN_FRONTEND=noninteractive LANG=C.UTF-8 LC_ALL=C.UTF-8 \
    WINEDEBUG=-all WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--disable-gpu
RUN dpkg --add-architecture i386 && apt-get -o Acquire::Retries=3 update && apt-get -o Acquire::Retries=3 install -y --no-install-recommends \
    ca-certificates curl gnupg xvfb xauth cabextract unzip p7zip-full \
    gcc gcc-mingw-w64-x86-64-posix python3 msitools util-linux fonts-liberation \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://dl.winehq.org/wine-builds/winehq.key | gpg --dearmor -o /etc/apt/keyrings/winehq.gpg \
    && printf '%s\n' 'deb [signed-by=/etc/apt/keyrings/winehq.gpg] https://dl.winehq.org/wine-builds/ubuntu/ noble main' > /etc/apt/sources.list.d/winehq.list \
    && rm -rf /var/lib/apt/lists/*
# 11.19 includes the Wine fix for page alignment under QEMU/Rosetta (Wine bug 58084).
RUN apt-get -o Acquire::Retries=3 update && apt-get -o Acquire::Retries=3 install -y --no-install-recommends winehq-devel=11.19~noble-1 \
    && curl -fsSL https://raw.githubusercontent.com/Winetricks/winetricks/20260125/src/winetricks -o /usr/local/bin/winetricks \
    && chmod +x /usr/local/bin/winetricks && rm -rf /var/lib/apt/lists/*
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
RUN userdel ubuntu && useradd --create-home --uid 1000 builder \
    && mkdir /opt/wine-template /home/builder/.cache \
    && chown builder:builder /opt/wine-template /home/builder/.cache
FROM tools AS base
COPY docker/install/decode.c docker/install/helper-launcher.c /opt/codesys-install/
RUN gcc -shared -fPIC -nostdlib -Wl,--no-undefined -O2 /opt/codesys-install/decode.c -o /opt/codesys-install/decode.so \
    && x86_64-w64-mingw32-gcc -municode -Wall -Wextra -O2 -static \
       /opt/codesys-install/helper-launcher.c -o /opt/codesys-install/CoreInstallerSupport.exe

# ARM setup uses FEX for 32-bit prerequisites that fault under Rosetta.
# Compilation is verified later under AMD64 Wine; FEX runs only setup.
FROM --platform=${SETUP_PLATFORM} ubuntu:24.04 AS arm-setup
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get -o Acquire::Retries=3 update \
    && apt-get -o Acquire::Retries=3 install -y --no-install-recommends \
       software-properties-common xvfb xauth cabextract unzip curl util-linux \
    && add-apt-repository -y ppa:fex-emu/fex \
    && apt-get -o Acquire::Retries=3 update \
    && apt-get -o Acquire::Retries=3 install -y --no-install-recommends \
       fex-emu-armv8.2=2610-1~n gcc python3 msitools p7zip-full fonts-liberation \
    && rm -rf /var/lib/apt/lists/*
COPY --from=base /usr /opt/fex-rootfs/usr
COPY --from=base /lib /opt/fex-rootfs/lib
COPY --from=base /lib64 /opt/fex-rootfs/lib64
COPY --from=base /bin /opt/fex-rootfs/bin
COPY --from=base /sbin /opt/fex-rootfs/sbin
COPY --from=base /etc /opt/fex-rootfs/etc
COPY --from=base /opt/wine-devel /opt/fex-rootfs/opt/wine-devel
COPY --from=base /usr/local/bin/winetricks /usr/local/bin/winetricks
COPY --from=base /opt/codesys-install /opt/codesys-install
ENV FEX_ROOTFS=/opt/fex-rootfs WINEDLLPATH=/opt/fex-rootfs/opt/wine-devel/lib/wine \
    WINE64=wine LANG=C.UTF-8 LC_ALL=C.UTF-8 WINEDEBUG=-all
RUN rm -f /opt/fex-rootfs/etc/resolv.conf /opt/fex-rootfs/etc/hosts /opt/fex-rootfs/etc/hostname \
    && ln -s /opt/fex-rootfs/opt/wine-devel /opt/wine-devel \
    && printf '#!/bin/sh\nexec FEX /opt/wine-devel/bin/wine "$@"\n' > /usr/local/bin/wine \
    && printf '#!/bin/sh\nexec FEX /opt/wine-devel/bin/wineserver "$@"\n' > /usr/local/bin/wineserver \
    && chmod +x /usr/local/bin/wine /usr/local/bin/wineserver \
    && gcc -shared -fPIC -nostdlib -Wl,--no-undefined -O2 /opt/codesys-install/decode.c -o /opt/codesys-install/decode.so \
    && userdel ubuntu && useradd --create-home --uid 1000 builder \
    && mkdir /opt/wine-template /home/builder/.cache \
    && chown builder:builder /opt/wine-template /home/builder/.cache

FROM scratch AS installer-download
# The archive URL serves this exact release without Store credentials.
ADD --chmod=0644 --checksum=sha256:06f8abceffffbeb23edbc909e0f06133b47d6708bf66799b5699bc08daa01c19 \
    https://store-archive.codesys.com/ftp_download/3S/CODESYS/300000/3.5.22.30/CODESYS%2064%203.5.22.30.exe /codesys.exe

FROM ${SETUP_BASE} AS installer-local
RUN --mount=type=bind,from=installer,source=codesys.exe,target=/tmp/codesys.exe \
    echo '06f8abceffffbeb23edbc909e0f06133b47d6708bf66799b5699bc08daa01c19  /tmp/codesys.exe' | sha256sum --check - \
    && cp /tmp/codesys.exe /codesys.exe && chmod 644 /codesys.exe

FROM ${INSTALLER_SOURCE} AS installer-file

FROM ${SETUP_BASE} AS init
RUN arch=$(dpkg --print-architecture) \
    && curl -fsSL --retry 3 "https://github.com/krallin/tini/releases/download/v0.19.0/tini-$arch" -o "/tmp/tini-$arch" \
    && curl -fsSL --retry 3 "https://github.com/krallin/tini/releases/download/v0.19.0/tini-$arch.sha256sum" -o /tmp/tini.sha256sum \
    && (cd /tmp && sha256sum -c tini.sha256sum) \
    && install -m 755 "/tmp/tini-$arch" /usr/local/bin/tini

FROM base AS runtime-init
RUN curl -fsSL --retry 3 'https://github.com/krallin/tini/releases/download/v0.19.0/tini-amd64' -o /tmp/tini-amd64 \
    && curl -fsSL --retry 3 'https://github.com/krallin/tini/releases/download/v0.19.0/tini-amd64.sha256sum' -o /tmp/tini.sha256sum \
    && (cd /tmp && sha256sum -c tini.sha256sum) \
    && install -m 755 /tmp/tini-amd64 /usr/local/bin/tini

FROM ${SETUP_BASE} AS prerequisites
COPY docker/install/prerequisites.sh /opt/codesys-install/prerequisites.sh
USER builder
ENV WINEPREFIX=/opt/wine-template HOME=/home/builder WINEARCH=win64
RUN --mount=type=bind,from=installer,source=winetricks,target=/tmp/download-cache \
    --mount=type=cache,id=codesys-winetricks-20260125,target=/home/builder/.cache/winetricks,uid=1000,gid=1000 \
    cp -Rn /tmp/download-cache/. /home/builder/.cache/winetricks/ \
    && xvfb-run -a /opt/codesys-install/prerequisites.sh

FROM prerequisites AS webview
RUN curl --fail --location --retry 3 --connect-timeout 30 --max-time 600 \
      'https://go.microsoft.com/fwlink/p/?LinkId=2124701' -o /tmp/webview2.exe \
    && xvfb-run -a timeout --foreground 10m wine /tmp/webview2.exe /silent /install \
    && wineserver -k && wineserver -w && rm /tmp/webview2.exe

FROM webview AS core
COPY --chmod=755 docker/install/core.sh docker/install/extract.py /opt/codesys-install/
RUN --mount=type=bind,from=installer-file,source=/codesys.exe,target=/tmp/codesys.exe \
    xvfb-run -a /opt/codesys-install/core.sh /tmp/codesys.exe

FROM core AS installed
COPY --from=init /usr/local/bin/tini /usr/local/bin/tini
COPY docker/install/install.sh docker/install/verify.py /opt/codesys-install/
COPY docker/install/device /opt/codesys-install/device
# Wine starts orphaned helpers; BuildKit RUN needs the same reaping as docker run --init.
RUN tini -s -g -- xvfb-run -a /opt/codesys-install/install.sh

# Build the Wine-only signal adapter independently of the expensive setup cache.
FROM base AS wine-signal-compat
RUN apt-get -o Acquire::Retries=3 update \
    && apt-get -o Acquire::Retries=3 install -y --no-install-recommends libc6-dev \
    && rm -rf /var/lib/apt/lists/*
COPY docker/install/wine-signal /opt/codesys-install/wine-signal
RUN /opt/codesys-install/wine-signal/build.sh /opt/vplc-wine-compat

# Only the installed prefix leaves setup. After observed managed faults under FEX,
# the compiler uses AMD64 Wine without setup's FEX wrappers, rootfs or environment.
FROM base AS builder
COPY --from=installed --chown=builder:builder /opt/wine-template /opt/wine-template
COPY --from=wine-signal-compat /opt/vplc-wine-compat /opt/vplc-wine-compat
COPY --chmod=755 docker/install/wine-signal/wine /usr/local/bin/wine
USER root
COPY docker/install/wine-ncrypt /opt/codesys-install/wine-ncrypt
RUN python3 /opt/codesys-install/wine-ncrypt/enable-oaep.py \
    /opt/wine-devel/lib/wine/x86_64-windows/ncrypt.dll \
    /opt/wine-template/drive_c/windows/system32/ncrypt.dll
COPY --chmod=755 docker/install/verify.sh /opt/codesys-install/verify.sh
COPY --from=runtime-init /usr/local/bin/tini /usr/local/bin/tini
USER builder
ENV WINEPREFIX=/opt/wine-template HOME=/home/builder WINEARCH=win64
RUN tini -s -g -- xvfb-run -a /opt/codesys-install/verify.sh
USER root
WORKDIR /opt/codesys-build
COPY package.json ./
RUN bun install --production \
    && mkdir -p /node_modules/@vplc \
    && ln -s /opt/codesys-build /node_modules/@vplc/build
COPY shared-config /opt/vplc-config
RUN ln -s /opt/codesys-build/node_modules /opt/vplc-config/node_modules
RUN ln -s /opt/vplc-config /node_modules/@vplc/config
COPY src ./src
RUN bun build src/index.ts --target=node --packages=external --outdir dist
COPY python ./python
COPY docker/entrypoint.sh docker/runner.ts docker/config.ts ./docker/
RUN chmod +x docker/entrypoint.sh
ENV WINEPREFIX=/tmp/codesys-wine HOME=/tmp/codesys-home WINEARCH=win64 \
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--disable-gpu
WORKDIR /workspace
ENTRYPOINT ["/opt/codesys-build/docker/entrypoint.sh"]
CMD ["--help"]
