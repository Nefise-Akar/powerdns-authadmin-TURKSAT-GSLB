# Test stack

PowerDNS, the panel, Keycloak and PowerGSLB on one host - the setup the GSLB integration
(ADR-0024) was developed and tested on. For production use `../docker-compose.production.yml`
with `../production.env.example` instead.

## 1. Panel image

From the repository root:

```sh
docker build -t powerdns-authadmin:local .
```

## 2. Settings

```sh
cp test-stack.env.example .env && chmod 600 .env
```

Fill in every empty value; each line says how to generate it.

## 3. Certificates

Keycloak and PowerGSLB serve https with certificates from a private test CA; the panel
trusts that CA through `NODE_EXTRA_CA_CERTS`. Everything goes into `certs/` next to
`docker-compose.yml` (keys never leave it; `*.key`, `*.pem`, `*.crt` are git-ignored).

```sh
mkdir -p certs && cd certs && umask 077

# CA
openssl genrsa -out ca.key 4096
openssl req -x509 -new -key ca.key -sha256 -days 825 -subj "/CN=Test CA" -out ca.crt

# Keycloak
openssl genrsa -out keycloak.key 2048
openssl req -new -key keycloak.key -subj "/CN=keycloak" -out keycloak.csr
printf 'subjectAltName=DNS:keycloak,DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n' > keycloak.ext
openssl x509 -req -in keycloak.csr -CA ca.crt -CAkey ca.key -CAcreateserial -days 365 -sha256 \
  -extfile keycloak.ext -out keycloak.crt

# PowerGSLB (certificate and key in one file)
openssl genrsa -out powergslb.key 2048
openssl req -new -key powergslb.key -subj "/CN=powergslb" -out powergslb.csr
printf 'subjectAltName=DNS:powergslb,DNS:localhost,IP:127.0.0.1\nextendedKeyUsage=serverAuth\n' > powergslb.ext
openssl x509 -req -in powergslb.csr -CA ca.crt -CAkey ca.key -CAserial ca.srl -days 365 -sha256 \
  -extfile powergslb.ext -out powergslb.crt
cat powergslb.crt powergslb.key > powergslb.pem

chmod 644 ca.crt keycloak.crt powergslb.crt
# Keycloak runs as uid 1000, so keycloak.key (600) must be owned by uid 1000 - the first
# desktop user on most hosts. PowerGSLB wants a root-owned 600 file.
sudo chown root:root powergslb.pem && sudo chmod 600 powergslb.pem
cd ..
```

## 4. Start

```sh
docker compose up -d
```

| Service   | Address                                                     |
| --------- | ----------------------------------------------------------- |
| Panel     | http://localhost:3000                                       |
| PowerDNS  | DNS on port 5300, API `http://pdns:8081` inside the network |
| PowerGSLB | DNS on port 5301, admin https://localhost:9443/admin/       |
| Keycloak  | https://localhost:8443                                      |

## 5. PowerGSLB first run

In the PowerGSLB admin UI:

1. Change the default admin password (see the PowerGSLB README).
2. Create a service account for the panel (for example `panel-servis`) with a strong password.
3. Delete the sample data (the `example.*` domains, their records, sample views and monitors);
   keep the `Public` view.

## 6. Panel

1. Sign in with `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` and set a new password.
2. **Admin → Servers:** add PowerDNS - base URL `http://pdns:8081`, API key = `PDNS_API_KEY`.
3. **Admin → GSLB:** add PowerGSLB - base URL `https://powergslb`, the service account from
   step 5, nameserver host `ns1.gslb.<zone>.` and its address. Press **Test connection**.
4. Add regions (one per site, with the client/resolver CIDRs), then switch GSLB on per A/AAAA
   record in a zone's record table.

A new GSLB subzone can take up to 5 minutes to answer (PowerGSLB's zone cache); to skip the
wait: `docker compose exec powergslb pdns_control rediscover`.

## Known limits

- GSLB on CNAME records is off: PowerGSLB 2.4.3 can't store a second row for a CNAME rrset
  (ADR-0024 §3).
- GSLB member addresses must be stable. Docker assigns container IPs in start order, so test
  web servers need fixed IPs (a user-defined network with `--ip`) or their GSLB members drift.
