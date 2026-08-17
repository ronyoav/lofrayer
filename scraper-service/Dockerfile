# AWS Lambda container image with a full Chromium baked in.
#
# We install the real Chrome that puppeteer ships rather than a stripped
# serverless build, because puppeteer-extra-plugin-stealth has to patch a
# genuine browser at launch time to get past CAL's MemCyco detection.
FROM public.ecr.aws/lambda/nodejs:22

# Amazon Linux's CDN can crawl on a slow link, and dnf's default 30s minimum
# transfer rate aborts the metadata refresh outright. Be patient instead.
RUN printf 'timeout=300\nminrate=100\nretries=10\n' >> /etc/dnf/dnf.conf

# Shared libraries Chrome needs. The Lambda base image is Amazon Linux 2023.
RUN dnf install -y \
      alsa-lib \
      atk \
      at-spi2-atk \
      at-spi2-core \
      cairo \
      cups-libs \
      libdrm \
      libX11 \
      libXcomposite \
      libXdamage \
      libXext \
      libXfixes \
      libXi \
      libXrandr \
      libXtst \
      libxkbcommon \
      mesa-libgbm \
      nspr \
      nss \
      pango \
      liberation-fonts \
    && dnf clean all \
    && rm -rf /var/cache/dnf

# Chrome is downloaded here at build time and resolved from here at runtime,
# so this must be set before `npm ci` and must persist into the running image.
ENV PUPPETEER_CACHE_DIR=/opt/puppeteer

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY index.js browser.js fetch-page.js smoke-test.js ./

CMD [ "index.handler" ]
