(()=>{"use strict";module.exports=[80314,e=>{var r=e.i(49507),t=e.i(69896);function s(e){return"string"==typeof e&&t.n.test(e)}async function n(e){if(!s(e))throw Error("hashPin: PIN tidak memenuhi format yang diizinkan.");return(0,r.Z)(e)}async function a(e,t){return s(e)?"string"!=typeof t||0===t.length?(await (0,r.S)(e),!1):(0,r.B)(e,t):(await (0,r.S)("string"==typeof e?e:""),!1)}e.s(["z",0,n,"K",0,s,"w",0,a])},45671,e=>e.a(async(r,t)=>{try{var s=e.i(49794),n=e.i(43793),a=e.i(18659),i=r([n]);async function c(){let e=(0,n.f)();try{let r=(await e.query(`SELECT pin_hash, access_enabled, access_version
         FROM private_archives
        WHERE slug = $1`,[s.y])).rows[0];if(!r)return null;return{pinHash:r.pin_hash,accessEnabled:r.access_enabled,accessVersion:Number(r.access_version)}}catch(e){if((0,a.a)(e))throw new a.y;throw e}}async function u(e,r){if("string"!=typeof r||0===r.length)throw Error("setArchivePin: refusing to store an empty PIN hash.");let t=(0,n.f)();try{let n=(await t.query(`WITH ensure AS (
         INSERT INTO private_archives (slug, status, created_by)
         VALUES ($1, 'draft', $2)
         ON CONFLICT (slug) DO NOTHING
         RETURNING slug
       ),
       target AS (
         SELECT slug FROM ensure
         UNION ALL
         SELECT slug FROM private_archives WHERE slug = $1
         LIMIT 1
       )
       UPDATE private_archives p
          SET pin_hash = $3,
              pin_updated_at = now(),
              access_version = p.access_version + 1
         FROM target t
        WHERE p.slug = t.slug
       RETURNING p.access_version`,[s.y,e,r])).rows[0];if(!n)throw Error("setArchivePin: the private archive row was not updated.");return Number(n.access_version)}catch(e){if((0,a.a)(e))throw new a.y;throw e}}[n]=i.then?(await i)():i,e.s(["n",0,c,"L",0,u]),t()}catch(e){t(e)}},!1),91433,e=>{e.s(["f",0,function(e,r=process.env){let t=function(e=process.env){let r=e.ARCHIVE_TRUSTED_PROXY_HEADER;if("string"!=typeof r)return null;let t=r.trim().toLowerCase();return t.length?t:null}(r);if(!t)return null;let s=e.headers.get(t);if(!s)return null;let n=s.split(",")[0].trim();return n.length?n:null}])}]})();

//# sourceMappingURL=src_lib_archive_access_0youm26135uem._.js.map