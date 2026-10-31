package com.cliqheart.app

import android.view.View
import androidx.navigation.fragment.NavHostFragment
import androidx.recyclerview.widget.RecyclerView
import androidx.test.espresso.Espresso.onView
import androidx.test.espresso.action.ViewActions.click
import androidx.test.espresso.matcher.ViewMatchers.withId
import androidx.test.ext.junit.rules.ActivityScenarioRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.cliqheart.app.feature.home.MainShellFragment
import com.cliqheart.app.feature.home.tabs.HomeFeedFragment
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ReelsPageTest {
    @get:Rule
    val activityRule = ActivityScenarioRule(MainActivity::class.java)

    @Test
    fun reelsUsesFullAvailableViewportAndKeepsBottomNavigationVisible() {
        activityRule.scenario.onActivity { activity ->
            val navHost = activity.supportFragmentManager
                .findFragmentById(R.id.nav_host) as NavHostFragment
            if (navHost.navController.currentDestination?.id != R.id.mainShellFragment) {
                navHost.navController.navigate(R.id.mainShellFragment)
            }
        }
        InstrumentationRegistry.getInstrumentation().waitForIdleSync()

        onView(withId(R.id.reelsTab)).perform(click())
        InstrumentationRegistry.getInstrumentation().waitForIdleSync()

        activityRule.scenario.onActivity { activity ->
            val navHost = activity.supportFragmentManager
                .findFragmentById(R.id.nav_host) as NavHostFragment
            val shell = navHost.childFragmentManager.fragments
                .filterIsInstance<MainShellFragment>()
                .single()
            val reels = shell.childFragmentManager.fragments
                .filterIsInstance<HomeFeedFragment>()
                .single { it.requireArguments().getBoolean(HomeFeedFragment.ARG_REELS_MODE) }
            val viewport = reels.requireView()
            val recycler = viewport.findViewById<RecyclerView>(R.id.feed_recycler_view)
            val swipeRefresh = viewport.findViewById<androidx.swiperefreshlayout.widget.SwipeRefreshLayout>(
                R.id.swipe_refresh_layout,
            )
            val header = viewport.findViewById<View>(R.id.home_header)
            val bottomNavigation = shell.requireView().findViewById<View>(R.id.bottom_navigation)

            assertEquals(View.GONE, header.visibility)
            assertEquals(false, swipeRefresh.isEnabled)
            assertEquals(shell.requireView().findViewById<View>(R.id.tab_container).width, recycler.width)
            assertEquals(shell.requireView().findViewById<View>(R.id.tab_container).height, viewport.height)
            assertTrue(recycler.height > 0)
            assertTrue(bottomNavigation.isShown)
        }
    }
}
