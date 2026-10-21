module.exports=[23693,e=>e.a(async(s,t)=>{try{var r=e.i(66680),a=e.i(49794),n=e.i(43793),i=e.i(18659),c=e.i(69896),o=s([n]);function h(e){return(0,r.createHash)("sha256").update(e).digest("hex")}async function l(e={}){let s,t=(0,r.randomBytes)(32).toString("hex"),o=h(t),u=(0,n.f)();try{s=await u.query(`INSERT INTO archive_access_sessions (token_hash, access_version, expires_at, ip_address, user_agent)
       SELECT $2, a.access_version, now() + $3::interval, $4, $5
         FROM private_archives a
        WHERE a.slug = $1
          AND a.access_enabled = true
          AND a.pin_hash IS NOT NULL
       RETURNING id`,[a.y,o,`${c.j} hours`,e.ipAddress??null,e.userAgent??null])}catch(e){if((0,i.a)(e))throw new i.y;throw e}if(!s.rows.length)throw new i.r;return t}async function u(e){let s;if(!e)return null;let t=h(e),r=(0,n.f)();try{s=await r.query(`SELECT s.id
         FROM archive_access_sessions s
         JOIN private_archives a ON a.slug = $2
        WHERE s.token_hash = $1
          AND s.revoked_at IS NULL
          AND s.expires_at > now()
          AND a.access_enabled = true
          AND a.pin_hash IS NOT NULL
          AND s.access_version = a.access_version`,[t,a.y])}catch(e){if((0,i.a)(e))throw new i.y;throw e}return s.rows.length?{id:s.rows[0].id}:null}async function _(e){if(!e)return;let s=(0,n.f)();try{await s.query(`UPDATE archive_access_sessions SET revoked_at = now()
        WHERE token_hash = $1 AND revoked_at IS NULL`,[h(e)])}catch(e){if((0,i.a)(e))throw new i.y;throw e}}[n]=o.then?(await o)():o;let f={httpOnly:!0,secure:!0,sameSite:"lax",path:"/"};e.s(["C",0,function(e){e.cookies.set(c.p,"",{...f,maxAge:0})},"U",0,l,"J",0,function(e){let s=e.headers.get("cookie");if(!s)return null;for(let e of s.split(";")){let s=e.indexOf("=");if(-1!==s&&e.slice(0,s).trim()===c.p){let t=e.slice(s+1).trim();return t.length?t:null}}return null},"z",0,_,"I",0,function(e,s){e.cookies.set(c.p,s,{...f,maxAge:60*c.j*60})},"K",0,u]),t()}catch(e){t(e)}},!1)];

//# sourceMappingURL=src_lib_archive_access_session_ts_186g7ow_zi5cz._.js.map