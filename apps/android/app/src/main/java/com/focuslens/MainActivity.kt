package com.focuslens

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.work.*
import java.util.concurrent.TimeUnit

class MainActivity : ComponentActivity() {

    private val pairing = mutableStateOf<Pair<String, String>?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val collector = UsageCollector(this)
        handlePairLink(intent)

        setContent {
            MaterialTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    val scanned by pairing
                    SetupScreen(
                        hasPermission = collector.hasPermission(),
                        savedUrl = scanned?.first ?: collector.agentUrl,
                        savedToken = scanned?.second ?: collector.token,
                        scannedFromQr = scanned != null,
                        onGrantPermission = { openUsageAccessSettings() },
                        onSave = { url, token ->
                            getSharedPreferences("focuslens", MODE_PRIVATE).edit()
                                .putString("agent_url", url)
                                .putString("agent_token", token)
                                .apply()
                            scheduleSyncJob()
                        }
                    )
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handlePairLink(intent)
    }

    /** Parses focuslens://pair?host=&port=&token= from a scanned QR code. */
    private fun handlePairLink(intent: Intent?) {
        val data: Uri = intent?.data ?: return
        if (data.scheme != "focuslens" || data.host != "pair") return
        val host = data.getQueryParameter("host") ?: return
        val port = data.getQueryParameter("port") ?: "48732"
        val token = data.getQueryParameter("token") ?: ""
        pairing.value = "http://$host:$port" to token
    }

    private fun openUsageAccessSettings() {
        startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS))
    }

    private fun scheduleSyncJob() {
        val req = PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES)
            .setConstraints(Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build())
            .build()
        WorkManager.getInstance(this).enqueueUniquePeriodicWork(
            "focuslens-sync",
            ExistingPeriodicWorkPolicy.UPDATE,
            req
        )
    }
}

@Composable
fun SetupScreen(
    hasPermission: Boolean,
    savedUrl: String,
    savedToken: String,
    scannedFromQr: Boolean = false,
    onGrantPermission: () -> Unit,
    onSave: (String, String) -> Unit,
) {
    var url by remember(savedUrl) { mutableStateOf(savedUrl) }
    var token by remember(savedToken) { mutableStateOf(savedToken) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text("FocusLens", style = MaterialTheme.typography.headlineMedium)
        Text("Android companion", style = MaterialTheme.typography.bodyMedium)

        Spacer(Modifier.height(8.dp))

        if (scannedFromQr) {
            Card(modifier = Modifier.fillMaxWidth()) {
                Text(
                    "✓ Scanned from desktop — just confirm permission and tap save.",
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.padding(16.dp)
                )
            }
        }

        if (!hasPermission) {
            Card(modifier = Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Usage access required", style = MaterialTheme.typography.titleSmall)
                    Text(
                        "FocusLens needs permission to read app usage. Tap below, find FocusLens in the list, and enable access.",
                        style = MaterialTheme.typography.bodySmall
                    )
                    Button(onClick = onGrantPermission) { Text("Grant access →") }
                }
            }
        } else {
            Text("✓ Usage access granted", color = MaterialTheme.colorScheme.primary)
        }

        OutlinedTextField(
            value = url,
            onValueChange = { url = it },
            label = { Text("Desktop agent URL") },
            placeholder = { Text("http://192.168.1.100:48732") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
        )

        OutlinedTextField(
            value = token,
            onValueChange = { token = it },
            label = { Text("Pairing token") },
            placeholder = { Text("Paste from Settings → Pairing") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
        )

        Button(
            onClick = { onSave(url, token) },
            modifier = Modifier.fillMaxWidth(),
            enabled = url.isNotBlank() && token.isNotBlank() && hasPermission,
        ) {
            Text("Save & start syncing")
        }
    }
}
