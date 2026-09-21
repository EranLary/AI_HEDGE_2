# DNS Setup — hedge-in-a-box.com → Fly.io

Connecting `hedge-in-a-box.com` (Namecheap) to the `hedge-in-a-box-site` Fly app.

## Fly side (already done)

Certs created via CLI:

```bash
fly certs add hedge-in-a-box.com -a hedge-in-a-box-site
fly certs add www.hedge-in-a-box.com -a hedge-in-a-box-site
```

Target IPs:
- IPv4 (shared): `66.241.124.26`
- IPv6 (dedicated): `2a09:8280:1::109:6a51:0`

## Namecheap side (your turn)

1. Log into Namecheap → **Domain List** → **Manage** next to `hedge-in-a-box.com`
2. Confirm Nameservers = **Namecheap BasicDNS** (not Custom DNS)
3. Open the **Advanced DNS** tab
4. **Delete any existing records on `@` and `www`** — Namecheap adds default URL Redirect / parking records that will conflict
5. **Add New Record** four times:

| Type        | Host  | Value                       | TTL       |
| ----------- | ----- | --------------------------- | --------- |
| A Record    | `@`   | `66.241.124.26`             | Automatic |
| AAAA Record | `@`   | `2a09:8280:1::109:6a51:0`   | Automatic |
| A Record    | `www` | `66.241.124.26`             | Automatic |
| AAAA Record | `www` | `2a09:8280:1::109:6a51:0`   | Automatic |

6. Save each record (green checkmark)

## Verify

Wait a few minutes for DNS to propagate, then:

```bash
fly certs check hedge-in-a-box.com -a hedge-in-a-box-site
fly certs check www.hedge-in-a-box.com -a hedge-in-a-box-site
```

Both should report **Certificate Issued** once Let's Encrypt sees the records. Then `https://hedge-in-a-box.com` and `https://www.hedge-in-a-box.com` will serve the site.

## Troubleshooting

- **Still "Not verified" after 30 min** — confirm the records show up at `https://dnschecker.org/#A/hedge-in-a-box.com`. If not, check that Namecheap nameservers are BasicDNS and that you saved each record.
- **Cert status shows "Awaiting configuration"** — usually a stale cached lookup; re-run `fly certs check` a few minutes later.
- **www works but apex doesn't (or vice-versa)** — you missed one of the four records. Re-check the table above.
