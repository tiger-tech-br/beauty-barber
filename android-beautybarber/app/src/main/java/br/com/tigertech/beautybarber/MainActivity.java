package br.com.tigertech.beautybarber;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.SslErrorHandler;
import android.net.http.SslError;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.util.Objects;

/**
 * Aplicativo Android do Beauty Barber Studio: mesma origem HTTPS do site e da API.
 * Nenhum endereço ou cookie do PetCore é utilizado.
 */
public final class MainActivity extends Activity {
    private static final int COLOR_PETROL = Color.rgb(36, 75, 80);
    private static final int COLOR_IVORY = Color.rgb(247, 246, 243);

    private WebView webView;
    private LinearLayout errorPanel;
    private boolean pageFailed;
    private final Uri configuredOrigin = Uri.parse(BuildConfig.APP_URL);

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(COLOR_IVORY);
        webView = new WebView(this);
        root.addView(webView, new FrameLayout.LayoutParams(-1, -1));

        errorPanel = makeErrorPanel();
        errorPanel.setVisibility(View.GONE);
        root.addView(errorPanel, new FrameLayout.LayoutParams(-1, -1));
        setContentView(root);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false);
        settings.setSafeBrowsingEnabled(true);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false);

        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                pageFailed = false;
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (!request.isForMainFrame()) return false;
                Uri destination = request.getUrl();
                if ("https".equalsIgnoreCase(destination.getScheme())
                        && Objects.equals(configuredOrigin.getHost(), destination.getHost())
                        && destination.getPort() == -1) return false;

                // O checkout do PagBank e links de terceiros abrem no navegador do telefone.
                if ("https".equalsIgnoreCase(destination.getScheme()) || "mailto".equalsIgnoreCase(destination.getScheme())) {
                    try {
                        startActivity(new Intent(Intent.ACTION_VIEW, destination));
                    } catch (ActivityNotFoundException ignored) {
                        showError(getString(R.string.offline_message));
                    }
                }
                // Nunca carregar URL externa, HTTP ou esquemas não confiáveis no WebView.
                return true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    pageFailed = true;
                    showError(getString(R.string.offline_message));
                }
            }

            @Override
            public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                // Nunca permitir a continuação após erro no certificado HTTPS.
                handler.cancel();
                pageFailed = true;
                showError("Não foi possível validar a conexão segura do Beauty Barber Studio.");
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                if (!pageFailed && url != null && Objects.equals(configuredOrigin.getHost(), Uri.parse(url).getHost())) {
                    errorPanel.setVisibility(View.GONE);
                }
            }
        });

        if (state == null) webView.loadUrl(BuildConfig.APP_URL);
        else webView.restoreState(state);
    }

    private LinearLayout makeErrorPanel() {
        LinearLayout panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setGravity(Gravity.CENTER);
        int padding = (int) (28 * getResources().getDisplayMetrics().density);
        panel.setPadding(padding, padding, padding, padding);
        panel.setBackgroundColor(COLOR_IVORY);

        ImageView mark = new ImageView(this);
        mark.setImageResource(R.mipmap.ic_launcher);
        int iconSize = (int) (84 * getResources().getDisplayMetrics().density);
        panel.addView(mark, new LinearLayout.LayoutParams(iconSize, iconSize));

        TextView heading = new TextView(this);
        heading.setText(getString(R.string.offline_title));
        heading.setTextColor(COLOR_PETROL);
        heading.setTextSize(21);
        heading.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        heading.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams headingParams = new LinearLayout.LayoutParams(-1, -2);
        headingParams.topMargin = padding;
        panel.addView(heading, headingParams);

        TextView message = new TextView(this);
        message.setId(android.R.id.message);
        message.setText(getString(R.string.offline_message));
        message.setTextColor(Color.DKGRAY);
        message.setTextSize(16);
        message.setGravity(Gravity.CENTER);
        LinearLayout.LayoutParams messageParams = new LinearLayout.LayoutParams(-1, -2);
        messageParams.topMargin = padding / 2;
        panel.addView(message, messageParams);

        Button retry = new Button(this);
        retry.setText(R.string.retry);
        retry.setOnClickListener(view -> {
            errorPanel.setVisibility(View.GONE);
            webView.loadUrl(BuildConfig.APP_URL);
        });
        LinearLayout.LayoutParams retryParams = new LinearLayout.LayoutParams(-2, -2);
        retryParams.topMargin = padding;
        panel.addView(retry, retryParams);
        return panel;
    }

    private void showError(String message) {
        TextView text = errorPanel.findViewById(android.R.id.message);
        text.setText(message);
        errorPanel.setVisibility(View.VISIBLE);
    }

    @Override
    protected void onSaveInstanceState(Bundle state) {
        super.onSaveInstanceState(state);
        if (webView != null) webView.saveState(state);
    }

    @Override
    @Deprecated
    public void onBackPressed() {
        if (webView != null && errorPanel.getVisibility() != View.VISIBLE && webView.canGoBack()) {
            webView.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
