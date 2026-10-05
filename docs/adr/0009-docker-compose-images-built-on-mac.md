# Docker Compose on `<your-server>`, images built on the Mac and shipped over ssh

`api` and `web` run under Compose in `/opt/tracker`, bound to localhost, with memory limits (api 256M, web 512M) and a 4 GB swapfile. The VPS has about 1.9 GiB free and no swap, so `next build` must never run there. Images are built for linux/amd64 on the Mac and loaded with `docker save | ssh <your-server> docker load`, with no registry and no CI. We accept manual deploys to avoid running more infrastructure on a shared box. The tooling is pnpm workspaces and Biome.
