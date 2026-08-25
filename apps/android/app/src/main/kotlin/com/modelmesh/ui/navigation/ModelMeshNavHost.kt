package com.modelmesh.ui.navigation

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.modelmesh.ui.execution.ExecutionTraceScreen
import com.modelmesh.ui.input.MultimodalInputScreen
import com.modelmesh.ui.input.SharedContent
import com.modelmesh.ui.result.ResultScreen

/**
 * The three destinations and the only argument that ever crosses between them: a
 * `taskId` string. Nothing else — no snapshots, no attachments, no ViewModels — is
 * passed through navigation; each screen re-derives its state from the use cases via
 * its own `hiltViewModel()`, keyed by the taskId it reads from `SavedStateHandle`.
 * That keeps every destination survivable across process death.
 */
sealed class Screen(val route: String) {
    data object Input : Screen("input")

    data object Execution : Screen("execution/{$ARG_TASK_ID}") {
        fun route(taskId: String) = "execution/$taskId"
    }

    data object Result : Screen("result/{$ARG_TASK_ID}") {
        fun route(taskId: String) = "result/$taskId"
    }

    companion object {
        const val ARG_TASK_ID = "taskId"
    }
}

/**
 * Back-stack shape:
 *  - input → execution keeps `input` underneath, so Back from a live run returns to
 *    the composer;
 *  - execution → result pops `execution` (inclusive), so Back from a result never
 *    drops the user back into a now-finished trace;
 *  - input → result (opening a past task from history) leaves `input` underneath.
 *
 * [sharedContent] is a launch/`onNewIntent` share; it is forwarded only to the input
 * screen and cleared through [onSharedContentConsumed] once applied.
 */
@Composable
fun ModelMeshNavHost(
    modifier: Modifier = Modifier,
    navController: NavHostController = rememberNavController(),
    sharedContent: SharedContent? = null,
    onSharedContentConsumed: () -> Unit = {},
) {
    NavHost(
        navController = navController,
        startDestination = Screen.Input.route,
        modifier = modifier,
    ) {
        composable(Screen.Input.route) {
            MultimodalInputScreen(
                onNavigateToExecution = { taskId ->
                    navController.navigate(Screen.Execution.route(taskId)) {
                        popUpTo(Screen.Input.route) { inclusive = false }
                    }
                },
                onNavigateToResult = { taskId ->
                    navController.navigate(Screen.Result.route(taskId))
                },
                sharedContent = sharedContent,
                onSharedContentConsumed = onSharedContentConsumed,
            )
        }

        composable(
            route = Screen.Execution.route,
            arguments = listOf(navArgument(Screen.ARG_TASK_ID) { type = NavType.StringType }),
        ) {
            ExecutionTraceScreen(
                onBack = { navController.navigateUp() },
                onViewResult = { taskId ->
                    navController.navigate(Screen.Result.route(taskId)) {
                        popUpTo(Screen.Execution.route) { inclusive = true }
                    }
                },
            )
        }

        composable(
            route = Screen.Result.route,
            arguments = listOf(navArgument(Screen.ARG_TASK_ID) { type = NavType.StringType }),
        ) {
            ResultScreen(
                onBack = { navController.navigateUp() },
                onStartNew = {
                    navController.navigate(Screen.Input.route) {
                        popUpTo(Screen.Input.route) { inclusive = true }
                    }
                },
            )
        }
    }
}
