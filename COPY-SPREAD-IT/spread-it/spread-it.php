<?php
/*
Plugin Name: Spread It
Description: Front post form + Social share + Deferred AI (WP‑Cron). Captions hidden by default.
Version: 1.4.1
Author: OM43
*/

if (!defined('ABSPATH')) exit;

class Spread_It_Plugin {
    const OPT_GROUP = 'spread_it_group';
    const OPT_KEY   = 'spread_it_options';
    const META_AI   = '_spread_it_ai_json';
    const EVENT_AI_JOB = 'spread_it_ai_job';

    public function __construct() {
        /* Admin */
        add_action('admin_menu',  [$this,'add_settings_page']);
        add_action('admin_init',  [$this,'register_settings']);
        add_action('add_meta_boxes', [$this,'add_regenerate_metabox']);
        add_action('wp_ajax_spreadit_regenerate', [$this,'ajax_regenerate']);

        /* Front + commun */
        add_action('init',        [$this,'register_rewrites']); // harmless if tracking plugin absent
        add_filter('query_vars',  [$this,'register_query_vars']);
        add_action('template_redirect', [$this,'handle_redirect_tracker']); // noop if no vars

        add_shortcode('spread-it-site',   [$this,'shortcode_site_form']);
        add_shortcode('spread-it-social', [$this,'shortcode_social']);

        add_action('wp_enqueue_scripts',  [$this,'enqueue_assets']);

        /* Head meta for better previews */
        add_action('wp_head', [$this,'inject_social_meta'], 5);

        /* Cron handler */
        add_action(self::EVENT_AI_JOB, [$this,'run_ai_job'], 10, 1);
    }

    /* ================= SETTINGS (ADMIN) ================= */
    public function add_settings_page(){
        add_menu_page(
            'Spread It — Settings', 'Spread It',
            'manage_options', 'spread-it',
            [$this,'settings_page'], 'dashicons-share', 58
        );
        add_submenu_page('spread-it','Settings','Settings','manage_options','spread-it',[$this,'settings_page']);
        add_submenu_page('spread-it','AI Chat','AI Chat','manage_options','spread-it-ai-chat',[$this,'ai_chat_page']);
    }
    public function register_settings(){
        register_setting(self::OPT_GROUP, self::OPT_KEY, [
            'type'=>'array',
            'sanitize_callback'=>function($in){
                return [
                    'openai_api_key' => isset($in['openai_api_key']) ? trim($in['openai_api_key']) : '',
                    'openai_model'   => isset($in['openai_model']) ? sanitize_text_field($in['openai_model']) : 'gpt-4o-mini',
                    'auto_apply'     => empty($in['auto_apply']) ? 0 : 1,
                    'tone'           => sanitize_text_field($in['tone'] ?? 'sexy-bold-confident'),
                    'language_mode'  => sanitize_text_field($in['language_mode'] ?? 'en_fr_mix'),
                    'fr_percent'     => max(0, min(100, intval($in['fr_percent'] ?? 10))),
                    'max_hashtags'   => max(0, min(12, intval($in['max_hashtags'] ?? 6))),
                    'max_emojis'     => max(0, min(6,  intval($in['max_emojis'] ?? 2))),
                    'banned_words'   => trim($in['banned_words'] ?? ''),
                    'brand_terms'    => trim($in['brand_terms'] ?? 'ONLYMATT, OM43'),
                ];
            },
            'default'=>[
                'openai_api_key' => '',
                'openai_model'   => 'gpt-4o-mini',
                'auto_apply'     => 0,
                'tone'           => 'sexy-bold-confident',
                'language_mode'  => 'en_fr_mix',
                'fr_percent'     => 10,
                'max_hashtags'   => 6,
                'max_emojis'     => 2,
                'banned_words'   => '',
                'brand_terms'    => 'ONLYMATT, OM43',
            ]
        ]);
    }
    public function settings_page(){
        if (!current_user_can('manage_options')) return;
        $opt = get_option(self::OPT_KEY, []);
        ?>
        <div class="wrap">
          <h1>Spread It — Settings</h1>
          <form method="post" action="options.php">
            <?php settings_fields(self::OPT_GROUP); ?>
            <table class="form-table" role="presentation">
              <tr>
                <th><label for="openai_api_key">OpenAI API Key</label></th>
                <td><input type="password" id="openai_api_key" name="<?php echo esc_attr(self::OPT_KEY); ?>[openai_api_key]" class="regular-text" value="<?php echo esc_attr($opt['openai_api_key'] ?? ''); ?>" placeholder="sk-..." /></td>
              </tr>
              <tr>
                <th><label for="openai_model">OpenAI Model</label></th>
                <td><input type="text" id="openai_model" name="<?php echo esc_attr(self::OPT_KEY); ?>[openai_model]" class="regular-text" value="<?php echo esc_attr($opt['openai_model'] ?? 'gpt-4o-mini'); ?>" /></td>
              </tr>
              <tr>
                <th>Auto-apply</th>
                <td><label><input type="checkbox" name="<?php echo esc_attr(self::OPT_KEY); ?>[auto_apply]" value="1" <?php checked(!empty($opt['auto_apply'])); ?> /> Overwrite title/meta with AI suggestions</label></td>
              </tr>
              <tr><th colspan="2"><h2 style="margin-top:1rem">AI Policy</h2></th></tr>
              <tr>
                <th><label for="tone">Tone/Style</label></th>
                <td><input type="text" id="tone" name="<?php echo esc_attr(self::OPT_KEY); ?>[tone]" class="regular-text" value="<?php echo esc_attr($opt['tone'] ?? 'sexy-bold-confident'); ?>" /></td>
              </tr>
              <tr>
                <th><label for="language_mode">Language</label></th>
                <td>
                  <select id="language_mode" name="<?php echo esc_attr(self::OPT_KEY); ?>[language_mode'] ?>">
                    <option value="en" <?php selected(($opt['language_mode'] ?? 'en_fr_mix'),'en'); ?>>English</option>
                    <option value="fr" <?php selected(($opt['language_mode'] ?? 'en_fr_mix'),'fr'); ?>>Français</option>
                    <option value="en_fr_mix" <?php selected(($opt['language_mode'] ?? 'en_fr_mix'),'en_fr_mix'); ?>>English + un peu de français</option>
                  </select>
                  <span style="margin-left:8px">FR% <input type="number" min="0" max="100" step="1" style="width:80px" name="<?php echo esc_attr(self::OPT_KEY); ?>[fr_percent]" value="<?php echo esc_attr($opt['fr_percent'] ?? 10); ?>"></span>
                </td>
              </tr>
              <tr>
                <th><label for="max_hashtags">Max Hashtags</label></th>
                <td><input type="number" id="max_hashtags" name="<?php echo esc_attr(self::OPT_KEY); ?>[max_hashtags]" min="0" max="12" value="<?php echo esc_attr($opt['max_hashtags'] ?? 6); ?>" /></td>
              </tr>
              <tr>
                <th><label for="max_emojis">Max Emojis</label></th>
                <td><input type="number" id="max_emojis" name="<?php echo esc_attr(self::OPT_KEY); ?>[max_emojis]" min="0" max="6" value="<?php echo esc_attr($opt['max_emojis'] ?? 2); ?>" /></td>
              </tr>
              <tr>
                <th><label for="banned_words">Banned words/hashtags</label></th>
                <td><textarea id="banned_words" name="<?php echo esc_attr(self::OPT_KEY); ?>[banned_words]" class="large-text" rows="3"><?php echo esc_textarea($opt['banned_words'] ?? ''); ?></textarea></td>
              </tr>
              <tr>
                <th><label for="brand_terms">Brand terms (prefer)</label></th>
                <td><textarea id="brand_terms" name="<?php echo esc_attr(self::OPT_KEY); ?>[brand_terms]" class="large-text" rows="2"><?php echo esc_textarea($opt['brand_terms'] ?? 'ONLYMATT, OM43'); ?></textarea></td>
              </tr>
            </table>
            <?php submit_button(); ?>
          </form>
          <p><em>Tip:</em> après activation des réécritures, va dans <strong>Settings → Permalinks → Save</strong>.</p>
        </div>
        <?php
    }
    
    public function ai_chat_page(){
        if (!current_user_can('manage_options')) return;
        $api_url = 'https://ai-chat-template-liart.vercel.app/api/chat';
        ?>
        <div class="wrap">
          <h1>AI Chat Assistant</h1>
          <p>Discute avec l'AI pour gérer tes posts Spread It.</p>
          
          <div id="ai-chat-admin" style="max-width:800px;margin-top:2rem;background:#fff;border:1px solid #ccc;border-radius:8px;overflow:hidden;">
            <div style="background:#1a1a1a;color:#fff;padding:1rem;border-bottom:1px solid #333;">
              <strong>💬 Spread It AI</strong>
            </div>
            <div id="ai-messages" style="height:500px;overflow-y:auto;padding:1rem;background:#f9f9f9;">
              <div style="background:#e3f2fd;padding:.75rem;border-radius:8px;margin-bottom:1rem;">
                <strong>AI:</strong> Salut! Je peux t'aider à gérer tes posts. Demande-moi ce que tu veux: régénérer le contenu, extraire des liens commerciaux, créer des variations, etc.
              </div>
            </div>
            <div style="padding:1rem;background:#fff;border-top:1px solid #ddd;display:flex;gap:.5rem;">
              <input type="text" id="ai-input" placeholder="Demande quelque chose..." style="flex:1;padding:.5rem;border:1px solid #ccc;border-radius:4px;">
              <button id="ai-send" class="button button-primary">Envoyer</button>
            </div>
          </div>
        </div>
        
        <script>
          (function($){
            var apiUrl = '<?php echo esc_js($api_url); ?>';
            var history = [];
            var $messages = $('#ai-messages');
            var $input = $('#ai-input');
            var $send = $('#ai-send');
            
            function addMessage(role, content){
              var bg = role === 'user' ? '#fff3cd' : '#e3f2fd';
              var label = role === 'user' ? 'Toi' : 'AI';
              var html = '<div style="background:'+bg+';padding:.75rem;border-radius:8px;margin-bottom:1rem;"><strong>'+label+':</strong> '+content.replace(/\n/g,'<br>')+'</div>';
              $messages.append(html);
              $messages.scrollTop($messages[0].scrollHeight);
            }
            
            function send(){
              var text = $input.val().trim();
              if(!text) return;
              
              $input.val('');
              $send.prop('disabled', true);
              addMessage('user', text);
              
              $.ajax({
                url: apiUrl,
                method: 'POST',
                contentType: 'application/json',
                data: JSON.stringify({
                  message: text,
                  history: history,
                  siteInfo: {name: 'ONLYMATT Spread It Admin'}
                }),
                success: function(data){
                  if(data.response){
                    addMessage('assistant', data.response);
                    history.push({role: 'user', content: text});
                    history.push({role: 'assistant', content: data.response});
                    if(history.length > 20) history = history.slice(-20);
                  }
                  $send.prop('disabled', false);
                },
                error: function(){
                  addMessage('assistant', '❌ Erreur de connexion à l\'API.');
                  $send.prop('disabled', false);
                }
              });
            }
            
            $send.on('click', send);
            $input.on('keypress', function(e){
              if(e.which === 13) send();
            });
          })(jQuery);
        </script>
        <?php
    }
    
    public function add_regenerate_metabox(){
        add_meta_box(
            'spreadit_regenerate',
            '🤖 Spread It AI',
            [$this,'render_regenerate_metabox'],
            'post',
            'side',
            'high'
        );
    }
    
    public function render_regenerate_metabox($post){
        $ai_data = get_post_meta($post->ID, self::META_AI, true);
        $has_ai = !empty($ai_data);
        ?>
        <div style="text-align:center;padding:1rem 0">
          <button type="button" id="spreadit-regenerate-btn" class="button button-primary button-large" style="width:100%;margin-bottom:.5rem">
            🔄 <?php echo $has_ai ? 'Régénérer' : 'Analyser'; ?> avec AI
          </button>
          <div id="spreadit-regenerate-status" style="margin-top:.5rem;font-size:.9em;color:#666"></div>
          <?php if ($has_ai): ?>
            <p style="margin-top:.75rem;padding-top:.75rem;border-top:1px solid #ddd;font-size:.85em;color:#666">
              ✅ Dernière analyse effectuée
            </p>
          <?php endif; ?>
        </div>
        <script>
          (function($){
            $('#spreadit-regenerate-btn').on('click', function(){
              var btn = $(this);
              var status = $('#spreadit-regenerate-status');
              
              btn.prop('disabled', true).text('⏳ Analyse en cours...');
              status.html('').css('color', '#666');
              
              $.ajax({
                url: ajaxurl,
                method: 'POST',
                data: {
                  action: 'spreadit_regenerate',
                  post_id: <?php echo $post->ID; ?>,
                  nonce: '<?php echo wp_create_nonce('spreadit_regen_'.$post->ID); ?>'
                },
                success: function(res){
                  if(res.success){
                    status.html('✅ '+res.data.message).css('color', '#46b450');
                    btn.text('🔄 Régénérer avec AI');
                    setTimeout(function(){ location.reload(); }, 1500);
                  } else {
                    status.html('❌ '+res.data.message).css('color', '#dc3232');
                    btn.text('🔄 Réessayer');
                  }
                  btn.prop('disabled', false);
                },
                error: function(){
                  status.html('❌ Erreur de connexion').css('color', '#dc3232');
                  btn.text('🔄 Réessayer').prop('disabled', false);
                }
              });
            });
          })(jQuery);
        </script>
        <?php
    }
    
    public function ajax_regenerate(){
        $post_id = intval($_POST['post_id'] ?? 0);
        $nonce = $_POST['nonce'] ?? '';
        
        if (!wp_verify_nonce($nonce, 'spreadit_regen_'.$post_id)) {
            wp_send_json_error(['message' => 'Sécurité: nonce invalide']);
        }
        
        if (!current_user_can('edit_post', $post_id)) {
            wp_send_json_error(['message' => 'Permission refusée']);
        }
        
        $post = get_post($post_id);
        if (!$post) {
            wp_send_json_error(['message' => 'Post introuvable']);
        }
        
        // Analyser avec AI
        $ai = $this->analyze_with_openai($post_id);
        
        if (empty($ai)) {
            wp_send_json_error(['message' => 'Erreur AI - vérifie la clé OpenAI dans Settings']);
        }
        
        // Sauvegarder les données AI
        update_post_meta($post_id, self::META_AI, wp_json_encode($ai));
        
        // Appliquer si auto-apply est activé
        $opt = get_option(self::OPT_KEY, []);
        if (!empty($opt['auto_apply'])) {
            $upd = ['ID' => $post_id];
            if (!empty($ai['seo_title'])) $upd['post_title'] = wp_strip_all_tags($ai['seo_title']);
            if (!empty($ai['seo_description'])) $upd['post_excerpt'] = wp_strip_all_tags($ai['seo_description']);
            if (!empty($ai['improved_content'])) $upd['post_content'] = wp_kses_post($ai['improved_content']);
            wp_update_post($upd);
            
            if (!empty($ai['tags']) && is_array($ai['tags'])) {
                wp_set_post_tags($post_id, array_map('sanitize_text_field', $ai['tags']), true);
            }
            if (!empty($ai['categories']) && is_array($ai['categories'])) {
                $term_ids = [];
                foreach ($ai['categories'] as $cat) {
                    $t = term_exists($cat, 'category');
                    if (!$t) { $t = wp_insert_term($cat, 'category'); }
                    if (!is_wp_error($t) && !empty($t['term_id'])) $term_ids[] = intval($t['term_id']);
                }
                if ($term_ids) wp_set_post_categories($post_id, $term_ids, true);
            }
        }
        
        wp_send_json_success(['message' => 'Analyse terminée! Rechargement...']);
    }

    /* ================= ASSETS ================= */
    public function enqueue_assets(){
        wp_enqueue_script('jquery');
        $js = "(function(){
            document.addEventListener('click',function(e){
                var b=e.target.closest('.spreadit-copy-btn');
                if(!b) return;
                var i=b.previousElementSibling;
                if(i && i.select){ i.select(); document.execCommand('copy'); }
                b.textContent='Copied';
                setTimeout(function(){ b.textContent='Copy'; },1200);
            });
            document.addEventListener('click',function(e){
              var btn=e.target.closest('.btn.social.instagram,.btn.social.tiktok,.btn.social.youtube');
              if(!btn) return;
              e.preventDefault();
              var caption=btn.dataset.caption;
              var imgUrl=btn.dataset.image;
              var videoUrl=btn.dataset.video;
              var network=btn.querySelector('.label').textContent;
              if(caption){
                navigator.clipboard.writeText(caption).then(function(){
                  var orig=btn.innerHTML;
                  btn.innerHTML='<span class=\"label\">✓ Caption copiée!</span>';
                  setTimeout(function(){ btn.innerHTML=orig; },2000);
                });
              }
              // helper to pick extension and download
              function downloadUrl(url, defaultName){
                if(!url) return;
                try {
                  var ext = url.split('.').pop().split(/[#?]/)[0] || '';
                  var filename = defaultName + (ext ? '.'+ext : '');
                  var a=document.createElement('a');
                  a.href=url;
                  a.download=filename;
                  a.style.display='none';
                  document.body.appendChild(a);
                  a.click();
                  document.body.removeChild(a);
                } catch(err) { /* ignore */ }
              }
              if(imgUrl){ downloadUrl(imgUrl, 'spread-it-'+network.toLowerCase()); }
              if(videoUrl){ downloadUrl(videoUrl, 'spread-it-'+network.toLowerCase()); }
            });
        })();";
        wp_add_inline_script('jquery', $js);

        $css = '.spreadit-wrap{margin:1rem 0;font:inherit}'
             . '.spreadit-title{margin:0 0 .4rem 0;font-weight:600;letter-spacing:.04em}'
             . '.social-buttons{display:flex;flex-wrap:wrap;gap:.5rem}'
             . '.social-buttons .btn{display:inline-flex;align-items:center;justify-content:center;padding:.5rem .75rem;border-radius:.5rem;border:1px solid rgba(0,0,0,.12);text-decoration:none;color:inherit;background:#fff}'
             . '.social-buttons .btn:hover{background:rgba(0,0,0,.04)}'
             . '.social-buttons .btn .label{font-weight:500}'
             . '.spreadit-meta{margin-top:.75rem}'
             . '.spreadit-copy{display:none;gap:.5rem;margin:.25rem 0}' /* hidden by default */
             . '.spreadit-copy input{flex:1;padding:.5rem;border:1px solid rgba(0,0,0,.15);border-radius:.375rem;background:#fff}'
             . '.spreadit-copy-btn{padding:.5rem .75rem;border:1px solid rgba(0,0,0,.15);border-radius:.375rem;background:#fff;cursor:pointer}'
             . '.spreadit-form{display:grid;gap:.75rem}'
             . '.spreadit-form input[type=text],.spreadit-form input[type=url],.spreadit-form textarea{width:100%;padding:.6rem;border:1px solid rgba(0,0,0,.15);border-radius:.375rem}'
             . '.spreadit-form .row{display:grid;gap:.5rem}'
             . '@media(min-width:720px){.spreadit-form .row{grid-template-columns:1fr 1fr}}'
             . '@media (prefers-color-scheme: dark){'
             . '.social-buttons .btn{border-color:rgba(255,255,255,.18);background:#111;color:#eee}'
             . '.social-buttons .btn:hover{background:#1a1a1a}'
             . '.spreadit-copy input,.spreadit-copy-btn,.spreadit-form input,.spreadit-form textarea{border-color:rgba(255,255,255,.18);background:#111;color:#eee}'
             . '}';
        wp_register_style('spread-it-inline', false);
        wp_enqueue_style('spread-it-inline');
        wp_add_inline_style('spread-it-inline', $css);
    }

    /* ================= META TAGS ================= */
    public function inject_social_meta(){
        if (!is_singular()) return;
        global $post;
        $title = wp_get_document_title();
        $desc  = has_excerpt($post) ? wp_strip_all_tags(get_the_excerpt($post)) : wp_trim_words(wp_strip_all_tags($post->post_content), 32);
        $url   = get_permalink($post);
        $img   = '';
        if (has_post_thumbnail($post)) {
            $img = wp_get_attachment_image_url(get_post_thumbnail_id($post), 'full');
        }
        echo "\n<!-- Spread It OG/Twitter -->\n";
        echo '<meta property="og:type" content="article" />'."\n";
        echo '<meta property="og:title" content="'.esc_attr($title).'" />'."\n";
        echo '<meta property="og:description" content="'.esc_attr($desc).'" />'."\n";
        echo '<meta property="og:url" content="'.esc_url($url).'" />'."\n";
        if ($img) {
            echo '<meta property="og:image" content="'.esc_url($img).'" />'."\n";
            echo '<meta name="twitter:card" content="summary_large_image" />'."\n";
            echo '<meta name="twitter:image" content="'.esc_url($img).'" />'."\n";
        } else {
            echo '<meta name="twitter:card" content="summary" />'."\n";
        }
        echo '<meta name="twitter:title" content="'.esc_attr($title).'" />'."\n";
        echo '<meta name="twitter:description" content="'.esc_attr($desc).'" />'."\n";
        echo "<!-- /Spread It -->\n";
    }

    /* ================= REWRITES & TRACKER (safe if absent) ================= */
    public function register_rewrites(){
        add_rewrite_rule('^spread-go/([0-9]+)/([a-zA-Z0-9_-]+)/?$', 'index.php?spread_post=$matches[1]&spread_net=$matches[2]', 'top');
    }
    public function register_query_vars($vars){
        $vars[]='spread_post'; $vars[]='spread_net'; return $vars;
    }
    public function handle_redirect_tracker(){
        $pid = get_query_var('spread_post');
        $net = get_query_var('spread_net');
        if (!$pid || !$net) return;
        $pid = intval($pid); $net = sanitize_key($net);
        $k = '_spread_clicks_'.$net;
        $c = (int)get_post_meta($pid, $k, true);
        update_post_meta($pid, $k, $c+1);
        wp_safe_redirect(get_permalink($pid));
        exit;
    }
    private function tracked_url($post_id, $network){
        if (function_exists('spreadit_tracking_url')) {
            return spreadit_tracking_url($post_id, $network);
        }
        return get_permalink($post_id); // fallback: direct post URL
    }

    /* ================= SHORTCODE: SOCIAL ================= */
    public function shortcode_social($atts = []){
        if (!is_singular()) return '';
        $post_id = get_the_ID();
        $title   = get_the_title($post_id);
        $encoded = rawurlencode($title);

        $show_captions = !empty($atts['show_captions']) && (string)$atts['show_captions'] !== '0';

        $ai = json_decode(get_post_meta($post_id, self::META_AI, true) ?: '[]', true);
        $captions = $ai['captions'] ?? [];

        $nets = array_map('trim', explode(',', ($atts['networks'] ?? 'x,bluesky,facebook,linkedin,whatsapp,telegram,reddit,email,copy')));
        $links = [];
        $perma = get_permalink($post_id);
        // try to find a post-attached video (first one)
        $video_url = '';
        $videos = get_attached_media('video', $post_id);
        if (!empty($videos) && is_array($videos)) {
          $first = reset($videos);
          if (!empty($first->ID)) $video_url = wp_get_attachment_url($first->ID);
        }
        foreach ($nets as $n) {
            $k = strtolower($n);
            $url = $this->tracked_url($post_id, $k);
            $text = !empty($captions[$k]) ? rawurlencode($captions[$k]) : $encoded;
            switch ($k) {
                case 'x':
                  // Build a single `text` param containing caption + URL so URLs remain clickable
                  $cap_text = !empty($captions[$k]) ? $captions[$k] : $title;
                  $tweet_base = trim($cap_text . ' ' . $url);
                  // ensure we don't exceed Twitter's ~280 chars (truncate safely)
                  if (function_exists('mb_strlen')) {
                    if (mb_strlen($tweet_base) > 280) {
                      $tweet_base = mb_substr($tweet_base, 0, 277) . '...';
                    }
                  } else {
                    if (strlen($tweet_base) > 280) {
                      $tweet_base = substr($tweet_base, 0, 277) . '...';
                    }
                  }
                  $tweet_text = rawurlencode($tweet_base);
                  $links['X'] = "https://twitter.com/intent/tweet?text={$tweet_text}";
                  break;
                case 'bluesky':  $links['Bluesky']  = "https://bsky.app/intent/compose?text={$text}%20".rawurlencode($url); break;
                case 'facebook': $links['Facebook'] = "https://www.facebook.com/sharer/sharer.php?u=".rawurlencode($url); break;
                case 'linkedin': $links['LinkedIn'] = "https://www.linkedin.com/sharing/share-offsite/?url=".rawurlencode($url); break;
                case 'whatsapp': $links['WhatsApp'] = "https://api.whatsapp.com/send?text={$text}%20".rawurlencode($url); break;
                case 'telegram': $links['Telegram'] = "https://t.me/share/url?url=".rawurlencode($url)."&text={$text}"; break;
                case 'reddit':   $links['Reddit']   = "https://www.reddit.com/submit?url=".rawurlencode($url)."&title={$text}"; break;
                case 'instagram':
                    $links['Instagram'] = !empty($captions['instagram']) ? $captions['instagram'] : $title;
                    break;
                case 'tiktok':
                    $links['TikTok'] = !empty($captions['tiktok']) ? $captions['tiktok'] : $title;
                    break;
                case 'youtube':
                    $links['YouTube'] = !empty($captions['youtube']) ? $captions['youtube'] : $title;
                    break;
                case 'email':    $links['Email']    = "mailto:?subject={$encoded}&body=".rawurlencode($perma); break;
                case 'copy':     $links['Copy Link']= $perma; break;
            }
        }

        ob_start(); ?>
        <div class="spreadit-wrap">
          <h3 class="spreadit-title">SPREAD IT</h3>
          
          <?php if (!empty($ai['commercial']['has_affiliate']) && !empty($ai['commercial']['links'])): 
            // Dédupliquer les liens par URL
            $unique_links = [];
            foreach ($ai['commercial']['links'] as $link) {
              $url = $link['url'] ?? '';
              if ($url && !isset($unique_links[$url])) {
                $unique_links[$url] = $link;
              }
            }
          ?>
            <div class="spreadit-commercial" style="margin-bottom:1rem;padding:1rem;border:2px solid #f59e0b;border-radius:.5rem;background:rgba(245,158,11,.08)">
              <?php foreach ($unique_links as $link): ?>
                <div style="margin-bottom:.75rem">
                  <a href="<?php echo esc_url($link['url']); ?>" target="_blank" rel="noopener" class="btn" style="display:inline-block;padding:.75rem 1.5rem;background:#f59e0b;color:#fff;font-weight:600;text-decoration:none;border-radius:.5rem;text-align:center">
                    <?php echo esc_html($ai['commercial']['cta_text'] ?? 'Découvre maintenant'); ?>
                  </a>
                  <?php if (!empty($link['promo_code'])): ?>
                    <div style="margin-top:.5rem;font-size:.9em">
                      <strong>Code:</strong> <code style="background:rgba(0,0,0,.1);padding:.2rem .4rem;border-radius:.25rem"><?php echo esc_html($link['promo_code']); ?></code>
                      <?php if (!empty($link['expiry'])): ?>
                        <span style="color:#666"> · Expire: <?php echo esc_html($link['expiry']); ?></span>
                      <?php endif; ?>
                    </div>
                  <?php endif; ?>
                </div>
              <?php endforeach; ?>
            </div>
          <?php endif; ?>

          <div class="social-buttons">
            <?php 
            $feat_img = has_post_thumbnail($post_id) ? wp_get_attachment_url(get_post_thumbnail_id($post_id)) : '';
            foreach ($links as $label => $href): 
              $key = strtolower(preg_replace('/\s+/', '', $label));
              $is_manual = in_array($key, ['instagram','tiktok','youtube']);
            ?>
              <?php if ($label==='Copy Link'): ?>
                <div class="btn social copy" role="button" aria-label="Copy share link">
                  <span class="label">Copy</span>
                  <input type="text" value="<?php echo esc_attr($href); ?>" style="position:absolute;left:-9999px" readonly>
                </div>
              <?php elseif ($is_manual): ?>
                <a href="#" class="btn social <?php echo esc_attr($key); ?>" data-caption="<?php echo esc_attr($href); ?>" data-image="<?php echo esc_url($feat_img); ?>" data-video="<?php echo esc_url($video_url); ?>">
                  <span class="label"><?php echo esc_html($label); ?></span>
                </a>
              <?php else: ?>
                <a target="_blank" rel="noopener nofollow" href="<?php echo esc_url($href); ?>" class="btn social <?php echo esc_attr($key); ?>">
                  <span class="label"><?php echo esc_html($label); ?></span>
                </a>
              <?php endif; ?>
            <?php endforeach; ?>
          </div>

          <?php if ($show_captions && !empty($ai['captions']) && is_array($ai['captions'])): ?>
            <div class="spreadit-meta">
              <h4>AI Captions</h4>
              <?php foreach ($ai['captions'] as $net => $cap): ?>
                <div class="spreadit-copy" style="display:flex">
                  <input type="text" value="<?php echo esc_attr($cap); ?>" readonly>
                  <button type="button" class="spreadit-copy-btn">Copy</button>
                </div>
              <?php endforeach; ?>
            </div>
          <?php endif; ?>
        </div>
        <?php
        return ob_get_clean();
    }

    /* ================= SHORTCODE: SITE FORM ================= */
    public function shortcode_site_form(){
        $out = '';
        $notice = '';

        if ($_SERVER['REQUEST_METHOD']==='POST' && isset($_POST['spreadit_form_nonce']) && wp_verify_nonce($_POST['spreadit_form_nonce'],'spreadit_submit')) {
            $title   = sanitize_text_field($_POST['spreadit_title'] ?? '');
            $content = wp_kses_post($_POST['spreadit_content'] ?? '');
            $feat_url= esc_url_raw($_POST['spreadit_feat_url'] ?? '');
            $video_url = esc_url_raw($_POST['spreadit_video_url'] ?? '');
            $video_embed = wp_kses_post($_POST['spreadit_video_embed'] ?? '');
            $status = 'publish'; // jamais draft

            // créer le post
            $post_id = wp_insert_post([
                'post_title'   => $title ?: '(Untitled)',
                'post_content' => $content,
                'post_status'  => $status,
                'post_type'    => 'post',
            ], true);

            if (is_wp_error($post_id)) {
                $notice = '<div class="spreadit-error">Erreur: '.$post_id->get_error_message().'</div>';
            } else {
                // feature image: upload fichier
                if (!empty($_FILES['spreadit_feat_file']['name'])) {
                    $fid = $this->handle_upload_attachment($_FILES['spreadit_feat_file'], $post_id, ['image']);
                    if ($fid && !is_wp_error($fid)) set_post_thumbnail($post_id, $fid);
                }
                // feature image: URL distante
                if (!$this->has_thumbnail($post_id) && $feat_url) {
                    $fid = $this->sideload_image($feat_url, $post_id);
                    if ($fid && !is_wp_error($fid)) set_post_thumbnail($post_id, $fid);
                }

                // vidéo: upload fichier
                $video_html = '';
                if (!empty($_FILES['spreadit_video_file']['name'])) {
                    $vid = $this->handle_upload_attachment($_FILES['spreadit_video_file'], $post_id, ['video']);
                    if ($vid && !is_wp_error($vid)) {
                        $src = wp_get_attachment_url($vid);
                        $video_html = wp_video_shortcode(['src'=>$src]);
                    }
                }
                // vidéo: URL directe
                if (!$video_html && $video_url) {
                    $video_html = wp_video_shortcode(['src'=>$video_url]);
                }
                // vidéo: embed
                if (!$video_html && $video_embed) {
                    $video_html = $video_embed;
                }
                if ($video_html) {
                    $append = "\n\n<!-- SpreadIt Video -->\n".$video_html;
                    wp_update_post(['ID'=>$post_id,'post_content'=>$content.$append]);
                }

                // Déclencher AI en différé (pas d’appel direct)
                $this->schedule_ai_job($post_id);

                $perma = get_permalink($post_id);
                $notice = '<div class="spreadit-ok">✅ Publié. <a href="'.esc_url($perma).'">Voir le post</a></div>';
            }
        }

        ob_start(); ?>
        <div class="spreadit-wrap">
          <?php echo $notice; ?>
          <form class="spreadit-form" method="post" enctype="multipart/form-data">
            <?php wp_nonce_field('spreadit_submit','spreadit_form_nonce'); ?>
            <div>
              <label>Titre</label>
              <input type="text" name="spreadit_title" required>
            </div>
            <div>
              <label>Contenu</label>
              <textarea name="spreadit_content" rows="6" required></textarea>
            </div>

            <div class="row">
              <div>
                <label>Feature image (upload)</label>
                <input type="file" name="spreadit_feat_file" accept="image/*">
              </div>
              <div>
                <label>Feature image (URL)</label>
                <input type="url" name="spreadit_feat_url" placeholder="https://...jpg">
              </div>
            </div>

            <div class="row">
              <div>
                <label>Vidéo (upload)</label>
                <input type="file" name="spreadit_video_file" accept="video/*">
              </div>
              <div>
                <label>Vidéo (URL directe)</label>
                <input type="url" name="spreadit_video_url" placeholder="https://...mp4">
              </div>
            </div>
            <div>
              <label>Vidéo (embed code)</label>
              <input type="text" name="spreadit_video_embed" placeholder='<iframe ...>'>
            </div>

            <div>
              <button type="submit">Create + queue AI</button>
            </div>
          </form>
        </div>
        <?php
        $out .= ob_get_clean();
        return $out;
    }

    private function has_thumbnail($post_id){
        return (bool)get_post_thumbnail_id($post_id);
    }
    private function handle_upload_attachment($file_arr, $post_id, $allow_types = ['image','video']){
        if (empty($file_arr['name'])) return 0;
        require_once ABSPATH.'wp-admin/includes/file.php';
        require_once ABSPATH.'wp-admin/includes/media.php';
        require_once ABSPATH.'wp-admin/includes/image.php';
        $overrides = ['test_form'=>false];
        $movefile = wp_handle_upload($file_arr, $overrides);
        if (!empty($movefile['error'])) return new WP_Error('upload_error',$movefile['error']);

        $filetype = wp_check_filetype($movefile['file']);
        $mime = $filetype['type'] ?? '';
        $ok = false;
        foreach ($allow_types as $t) {
            if (strpos($mime, $t.'/') === 0) { $ok = true; break; }
        }
        if (!$ok) return new WP_Error('mime_error','Type de fichier non supporté');

        $attachment = [
            'post_mime_type' => $mime,
            'post_title'     => sanitize_file_name(basename($movefile['file'])),
            'post_content'   => '',
            'post_status'    => 'inherit'
        ];
        $attach_id = wp_insert_attachment($attachment, $movefile['file'], $post_id);
        if (is_wp_error($attach_id)) return $attach_id;
        $attach_data = wp_generate_attachment_metadata($attach_id, $movefile['file']);
        wp_update_attachment_metadata($attach_id, $attach_data);
        return $attach_id;
    }
    private function sideload_image($url, $post_id){
        if (!$url) return 0;
        require_once ABSPATH.'wp-admin/includes/media.php';
        require_once ABSPATH.'wp-admin/includes/file.php';
        require_once ABSPATH.'wp-admin/includes/image.php';
        $tmp = media_sideload_image($url, $post_id, null, 'id');
        return (is_wp_error($tmp)) ? 0 : intval($tmp);
    }

    /* ================= AI: DIFFÉRÉ ================= */
    public function schedule_ai_job($post_id){
        $post_id = intval($post_id);
        if ($post_id <= 0) return;
        if (!wp_next_scheduled(self::EVENT_AI_JOB, [$post_id])) {
            wp_schedule_single_event(time()+10, self::EVENT_AI_JOB, [$post_id]);
        }
    }
    public function run_ai_job($post_id){
        $post_id = intval($post_id);
        if ($post_id <= 0) return;

        $opt = get_option(self::OPT_KEY, []);
        $ai  = $this->analyze_with_openai($post_id); // [] si pas config/erreur
        if (!is_array($ai) || empty($ai)) return;

        update_post_meta($post_id, self::META_AI, wp_json_encode($ai));

        if (!empty($opt['auto_apply'])) {
            $upd = ['ID' => $post_id];
            if (!empty($ai['seo_title']))       $upd['post_title']   = wp_strip_all_tags($ai['seo_title']);
            if (!empty($ai['seo_description'])) $upd['post_excerpt'] = wp_strip_all_tags($ai['seo_description']);
            if (!empty($ai['improved_content'])) $upd['post_content'] = wp_kses_post($ai['improved_content']);
            wp_update_post($upd);

            if (!empty($ai['tags']) && is_array($ai['tags'])) {
                wp_set_post_tags($post_id, array_map('sanitize_text_field', $ai['tags']), true);
            }
            if (!empty($ai['categories']) && is_array($ai['categories'])) {
                $term_ids = [];
                foreach ($ai['categories'] as $cat) {
                    $t = term_exists($cat, 'category');
                    if (!$t) { $t = wp_insert_term($cat, 'category'); }
                    if (!is_wp_error($t) && !empty($t['term_id'])) $term_ids[] = intval($t['term_id']);
                }
                if ($term_ids) wp_set_post_categories($post_id, $term_ids, true);
            }
        }
    }
    public function analyze_with_openai($post_id){
        $opt = get_option(self::OPT_KEY, []);
        $api = $opt['openai_api_key'] ?? '';
        $model = $opt['openai_model'] ?? 'gpt-4o-mini';
        if (!$api) return [];

        $post = get_post($post_id);
        if (!$post) return [];

        $policy = [
            'tone'          => $opt['tone'] ?? 'sexy-bold-confident',
            'language_mode' => $opt['language_mode'] ?? 'en_fr_mix',
            'fr_percent'    => (int)($opt['fr_percent'] ?? 10),
            'max_hashtags'  => (int)($opt['max_hashtags'] ?? 6),
            'max_emojis'    => (int)($opt['max_emojis'] ?? 2),
            'banned_words'  => $opt['banned_words'] ?? '',
            'brand_terms'   => $opt['brand_terms'] ?? '',
        ];
        $signals = [
            'clicks'=>[
                'facebook'=>(int)get_post_meta($post_id,'_spread_clicks_facebook',true),
                'x'       =>(int)get_post_meta($post_id,'_spread_clicks_x',true),
                'linkedin'=>(int)get_post_meta($post_id,'_spread_clicks_linkedin',true),
                'whatsapp'=>(int)get_post_meta($post_id,'_spread_clicks_whatsapp',true),
            ]
        ];
        $schema = '{ "seo_title": "string", "seo_description": "string", "improved_content": "string", "tags": ["string"], "categories": ["string"], "alt_titles": ["string","string","string"], "captions": {"x": "string","bluesky": "string","instagram": "string","tiktok": "string","youtube":"string"}, "commercial": {"has_affiliate": boolean, "links": [{"url":"string","company":"string","promo_code":"string","expiry":"string"}], "cta_text": "string"} }';
        $content_text = wp_strip_all_tags($post->post_title."\n\n".$post->post_content);

        $sys = "You are a copy + SEO assistant for ONLYMATT. "
             . "tone={$policy['tone']}; language={$policy['language_mode']}(FR%={$policy['fr_percent']}); "
             . "max_hashtags={$policy['max_hashtags']}; max_emojis={$policy['max_emojis']}; "
             . "banned_words={$policy['banned_words']}; prefer_terms={$policy['brand_terms']}; "
             . "engagement_signals=".json_encode($signals, JSON_UNESCAPED_SLASHES)
             . ". PRESERVE ALL URLs exactly as provided. EXTRACT company names from URLs/content as tags. "
             . "IDENTIFY promo codes, expiry dates, affiliate links. If content has commercial URLs, set has_affiliate=true, "
             . "REWRITE the content (improved_content) to be more engaging, sexy, bold, and conversion-oriented while keeping the same message and ALL URLs. "
             . "Format improved_content with proper HTML paragraphs (<p>), line breaks (<br>), bold (<strong>), and preserve all links as clickable <a> tags. "
             . "extract all links with company name, promo codes, dates, and generate compelling CTA text. "
             . "Output STRICT JSON only.";

        $req = [
            'model'=>$model,
            'messages'=>[
                ['role'=>'system','content'=>$sys],
                ['role'=>'user','content'=>"SCHEMA:\n{$schema}\n\nReturn only JSON for this post content:\n{$content_text}"]
            ],
            'temperature'=>0.6,
            'response_format'=>['type'=>'json_object']
        ];

        $res = wp_remote_post('https://api.openai.com/v1/chat/completions', [
            'timeout'=>45,
            'headers'=>[
                'Authorization'=>'Bearer '.$api,
                'Content-Type'=>'application/json',
                'User-Agent'=>'WordPress/'.get_bloginfo('version').' +SpreadIt'
            ],
            'body'=>wp_json_encode($req),
        ]);

        if (is_wp_error($res)) return [];
        $code = wp_remote_retrieve_response_code($res);
        if ($code < 200 || $code >= 300) return [];
        $body = wp_remote_retrieve_body($res);
        $data = json_decode($body, true);
        $json = [];
        if (!empty($data['choices'][0]['message']['content'])) {
            $json = json_decode($data['choices'][0]['message']['content'], true);
            if (!is_array($json)) $json = [];
        }
        return $json;
    }
}

/* ================= Loader & Hooks ================= */
add_action('plugins_loaded', function(){
    $GLOBALS['spread_it_plugin'] = new Spread_It_Plugin();
});
register_activation_hook(__FILE__, function(){
    if (!wp_next_scheduled('spread_it_pull_metrics')) {
        wp_schedule_event(time()+300, 'hourly', 'spread_it_pull_metrics');
    }
    flush_rewrite_rules(false);
});
register_deactivation_hook(__FILE__, function(){
    wp_clear_scheduled_hook('spread_it_pull_metrics');
    flush_rewrite_rules(false);
});
