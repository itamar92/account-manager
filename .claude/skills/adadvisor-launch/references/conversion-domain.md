## `conversion_domain` — Meta's silent rejection

For any `adadvisor:create_ad` on a pixel-tracked campaign, the `conversion_domain` field is mandatory. Meta rejects with subcode **2490408** if missing or malformed. The rejection happens server-side before the ad is created — there is no "try again with the missing field" recovery; you must include it on the first call.

This reference encodes the format rule, the registrable-second-level-domain logic, the cases where you can skip it, and worked examples for tricky subdomains.

## The rule

`conversion_domain` must be a **registrable second-level domain**, not a URL and not a subdomain.

| Input | Valid? | Why |
|---|---|---|
| `example.com` | Yes | Registrable second-level domain |
| `example.co.uk` | Yes | Registrable second-level under the `.co.uk` public suffix |
| `https://example.com` | No | URL scheme not allowed |
| `https://example.com/` | No | Trailing slash; URL not allowed |
| `https://shop.example.com/path` | No | Full URL with subdomain and path |
| `shop.example.com` | No | Subdomain — strip to `example.com` |
| `www.example.com` | No | `www` is a subdomain; strip |
| `app.example.co.uk` | No | Strip subdomain; result is `example.co.uk` |
| `m.facebook.com` | No | Strip subdomain; result is `facebook.com` |

## Why "registrable second-level domain"

The Public Suffix List (publicsuffix.org) defines which domain levels are user-registrable vs operator-controlled. Meta uses this list to determine the conversion domain that an advertiser actually controls.

- `.com` is a public suffix. `example.com` is registrable → it's the conversion domain.
- `.co.uk` is a public suffix. `example.co.uk` is registrable → it's the conversion domain.
- `.s3.amazonaws.com` is also a public suffix. A bucket `my-bucket.s3.amazonaws.com` would be registrable at `my-bucket.s3.amazonaws.com` — though in practice, Meta usually expects branded domains here.

The verification mechanism Meta runs is: "is this the same domain you've verified in Business Manager Domains?" If you've verified `example.com`, you can pass `example.com`. You cannot pass `shop.example.com` and have it map to the verified parent.

## Worked examples — stripping subdomains

For each `link` value on a creative, compute the conversion domain:

| Creative `link` | `conversion_domain` |
|---|---|
| `https://shop.example.com/products/widget` | `example.com` |
| `https://www.example.com/checkout` | `example.com` |
| `https://app.example.co.uk/signup` | `example.co.uk` |
| `https://example.com.au/collection/sale` | `example.com.au` |
| `https://blog.example.de/article/2026` | `example.de` |
| `https://booking.example.ai` | `example.ai` |
| `https://localhost:3000/test` | INVALID — production domain required |
| `https://example.myshopify.com/products/x` | `example.myshopify.com` (only valid if Meta-verified at this level; otherwise the user must verify their custom domain instead) |

## The Public Suffix List rationale

Multi-level public suffixes are why "strip one subdomain" is the wrong heuristic. `example.co.uk` is correct; stripping further to `co.uk` is wrong (that's a public suffix, not registrable). Always check against the PSL pattern:

- `.com`, `.org`, `.net`, `.io`, `.ai`, `.app`, `.shop`, `.store`, `.online` → single-level suffixes; the registrable part is `<name>.<suffix>`.
- `.co.uk`, `.co.nz`, `.com.au`, `.com.br`, `.co.jp`, `.com.mx`, `.com.tr`, etc. → two-level suffixes; the registrable part is `<name>.<suffix>`.
- `.s3.amazonaws.com`, `.cloudfront.net` → operator-controlled multi-level suffixes; user-registrable below.

When in doubt, ask the user: "Which root domain did you verify in Meta Business Manager?" Use that exact string.

## When to skip `conversion_domain`

The field is required for pixel-tracked / conversion-attributed ads. Skip when:

- Objective is `OUTCOME_AWARENESS` (Reach, Brand Awareness, Video Views) — no conversion to attribute.
- Objective is `OUTCOME_ENGAGEMENT` (Page Likes, Post Engagement) — engagement is on-Meta.
- Lead-gen with on-Ad form (`destination_type: 'ON_AD'`, `lead_gen_form_id` on creative) — conversion is on Meta's surface, not a domain.
- Catalog DPA where the link is determined by the product feed — Meta resolves per-product.

Engagement and awareness ads pass without it. Lead-gen on-ad-form ads pass without it.

## The error you'll see if you skip

Meta returns (paraphrased from MCP error surface):

```
{
  "error": {
    "message": "Conversion Domain Required",
    "code": 100,
    "error_subcode": 2490408,
    "error_user_msg": "Please specify a conversion_domain for the ad."
  }
}
```

The MCP server surfaces this back to the agent. If you see subcode `2490408` in an error response, the fix is exclusively: add `conversion_domain` to the `create_ad` call. No retry without the field will work.

## Domain verification prerequisite

`conversion_domain` works only if the domain has been **verified in Meta Business Manager**. Verification methods:

- DNS TXT record at the root domain.
- HTML file upload to the verified server.
- Meta Pixel ownership.

If the domain isn't verified, even a correctly-formatted `conversion_domain` will result in ads that don't attribute conversions properly. This isn't an MCP-level error — it's a silent attribution failure visible only in performance reports.

Before launching for a new domain:

1. Confirm domain verification via Business Manager (the user has to do this; MCP can't verify on Meta's side).
2. Confirm pixel is firing on that domain (`adadvisor:get_pixel_health`).
3. Then pass the verified root in `conversion_domain`.

## Multi-domain accounts

If a single account runs ads to multiple verified domains (e.g., `brand-a.com` and `brand-b.com` under one Meta ad account), each `create_ad` call needs the `conversion_domain` matching that ad's destination. You cannot batch-create ads pointing to different domains and pass one shared `conversion_domain` — Meta validates per-ad.

The MCP server supports batched `create_ad` with per-ad `conversion_domain`. Each ad in the array gets its own field:

```
ads: [
  {adset_id: '...', creative_id: '...', conversion_domain: 'brand-a.com'},
  {adset_id: '...', creative_id: '...', conversion_domain: 'brand-b.com'}
]
```

## Extraction algorithm

For agents extracting `conversion_domain` from a creative's `link`:

1. Parse the URL.
2. Take the hostname.
3. Walk leftward, dropping subdomain segments, until reaching `<name>.<public-suffix>`.
4. Return that string.

Pseudo-implementation:

```
def extract_conversion_domain(link: str) -> str:
    from urllib.parse import urlparse
    host = urlparse(link).hostname  # e.g., 'shop.example.co.uk'
    # Use a Public Suffix List library (tldextract in Python)
    import tldextract
    e = tldextract.extract(host)
    # e.domain='example', e.suffix='co.uk'
    return f"{e.domain}.{e.suffix}"  # 'example.co.uk'
```

The MCP server does not auto-derive `conversion_domain` from the creative's `link`. Agents must pass it explicitly.

## Anti-patterns

- Pasting the full URL into `conversion_domain` — Meta rejects.
- Stripping only `https://` and passing `shop.example.com` — Meta rejects.
- Reusing the `conversion_domain` of a sibling ad pointing to a different brand — silent attribution mismatch.
- Setting `conversion_domain` to `facebook.com` because the ad uses Meta's surfaces — Meta rejects (it expects the advertiser's domain).
- Skipping verification because the field "validates" — verification is upstream, this field is a labeling system.

## See also

- [`./launch-checklist.md`](./launch-checklist.md) — includes the `conversion_domain` checkbox.
- [`./lead-gen-flow.md`](./lead-gen-flow.md) — when you can omit `conversion_domain` on lead-form ads.
- [`./eu-dsa.md`](./eu-dsa.md) — companion fields required for EU-targeted ad sets.
