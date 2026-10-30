package com.cliqheart.app

import android.view.View
import androidx.navigation.fragment.NavHostFragment
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.test.ext.junit.rules.ActivityScenarioRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.cliqheart.app.feature.home.MainShellFragment
import com.cliqheart.app.feature.home.tabs.HomeFeedFragment
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class HomeFeedStoriesTest {
    @get:Rule
    val activityRule = ActivityScenarioRule(MainActivity::class.java)

    @Test
    fun storiesRowRemainsVisibleAndHorizontalWhileStoriesLoad() {
        InstrumentationRegistry.getInstrumentation().waitForIdleSync()
        activityRule.scenario.onActivity { activity ->
            val navHost = activity.supportFragmentManager
                .findFragmentById(R.id.nav_host) as NavHostFragment
            navHost.navController.navigate(R.id.mainShellFragment)
            navHost.childFragmentManager.executePendingTransactions()
        }
        InstrumentationRegistry.getInstrumentation().waitForIdleSync()

        activityRule.scenario.onActivity { activity ->
            val navHost = activity.supportFragmentManager
                .findFragmentById(R.id.nav_host) as NavHostFragment
            val shell = navHost.childFragmentManager.fragments
                .filterIsInstance<MainShellFragment>()
                .single()
            val homeFeed = shell.childFragmentManager.fragments
                .filterIsInstance<HomeFeedFragment>()
                .single()
            val stories = homeFeed.requireView().findViewById<androidx.recyclerview.widget.RecyclerView>(
                R.id.stories_recycler_view,
            )
            assertNotNull(stories.layoutManager)
            assertEquals(View.VISIBLE, stories.visibility)
            assertEquals(
                LinearLayoutManager.HORIZONTAL,
                (stories.layoutManager as LinearLayoutManager).orientation,
            )
            org.junit.Assert.assertTrue((stories.adapter?.itemCount ?: 0) >= 1)
        }
    }
}
