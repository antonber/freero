// Which Freero server the app shows, and where a link opens in it. Pure: no window, no disk.
use tauri::Url;

/**
 * A server address people may choose: https, or http on this computer (development). Reduced to
 * its origin, so a pasted board link works too.
 */
pub fn parse_instance(text: &str) -> Option<Url> {
    let text = text.trim();
    let with_scheme = if text.contains("://") { text.to_string() } else { format!("https://{text}") };
    let mut url = Url::parse(&with_scheme).ok()?;
    let host = url.host_str()?.to_string();
    let local = host == "localhost" || host == "127.0.0.1";
    if !(url.scheme() == "https" || (url.scheme() == "http" && local)) {
        return None;
    }
    if !url.username().is_empty() || url.password().is_some() {
        return None;
    }
    url.set_path("/");
    url.set_query(None);
    url.set_fragment(None);
    Some(url)
}

fn plain_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 64 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

fn on_instance(instance: &Url, link: &str) -> Option<Url> {
    let url = Url::parse(link).ok()?;
    (url.origin() == instance.origin()).then_some(url)
}

/**
 * The page a link opens in the app, on `instance`: `freero://board/<id>` and `freero://doc/<id>`
 * (their query kept: `?item=`, `?thread=`), `freero://app`, `freero://open?url=<a page of the
 * instance>`, or such a page itself. Anything else — another site, another scheme — is not
 * opened inside the app (None).
 */
pub fn target_for(instance: &Url, link: &str) -> Option<Url> {
    let url = Url::parse(link.trim()).ok()?;
    match url.scheme() {
        "freero" => match url.host_str().unwrap_or("") {
            kind @ ("board" | "doc") => {
                let id = url.path().trim_matches('/');
                if !plain_id(id) {
                    return None;
                }
                let mut target = instance.join(&format!("{kind}/{id}")).ok()?;
                target.set_query(url.query());
                Some(target)
            }
            "app" | "" => instance.join("app").ok(),
            "open" => {
                let inner = url.query_pairs().find(|(k, _)| k == "url").map(|(_, v)| v.into_owned())?;
                on_instance(instance, &inner)
            }
            _ => None,
        },
        "https" | "http" => on_instance(instance, link),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn instance() -> Url {
        parse_instance("https://boards.example.com").unwrap()
    }

    #[test]
    fn a_link_to_another_site_or_scheme_never_opens_inside_the_app() {
        let i = instance();
        assert_eq!(target_for(&i, "https://evil.example.net/board/abc"), None);
        assert_eq!(target_for(&i, "freero://open?url=https://evil.example.net/app"), None);
        assert_eq!(target_for(&i, "javascript:alert(1)"), None);
        assert_eq!(target_for(&i, "freero://board/..%2F..%2Fapi%2Fauth"), None);
    }

    #[test]
    fn board_links_open_on_the_chosen_server_with_their_item() {
        let i = instance();
        assert_eq!(target_for(&i, "freero://board/Ab_3-x?item=s1").unwrap().as_str(), "https://boards.example.com/board/Ab_3-x?item=s1");
        assert_eq!(target_for(&i, "https://boards.example.com/board/abc").unwrap().as_str(), "https://boards.example.com/board/abc");
    }

    #[test]
    fn only_https_servers_are_accepted_except_on_this_computer() {
        assert_eq!(parse_instance("http://boards.example.com"), None);
        assert_eq!(parse_instance("https://user:pw@boards.example.com"), None);
        assert_eq!(parse_instance("boards.example.com/board/abc?x=1").unwrap().as_str(), "https://boards.example.com/");
        assert_eq!(parse_instance("http://localhost:4000").unwrap().as_str(), "http://localhost:4000/");
    }
}
