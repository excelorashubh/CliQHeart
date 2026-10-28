package com.cliqheart.app

import androidx.fragment.app.Fragment
import androidx.navigation.fragment.NavHostFragment
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.ext.junit.rules.ActivityScenarioRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.cliqheart.app.feature.home.MainShellFragment
import com.cliqheart.app.feature.home.tabs.ActivityFragment
import com.cliqheart.app.feature.home.tabs.CreatePostFragment
import com.cliqheart.app.feature.home.tabs.DiscoverFragment
import com.cliqheart.app.feature.home.tabs.HomeFeedFragment
import com.cliqheart.app.feature.home.tabs.ProfileFragment
import com.google.android.material.bottomnavigation.BottomNavigationView
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class BottomNavigationTest {
    @get:Rule
    val activityRule = ActivityScenarioRule(MainActivity::class.java)

    @Test
    fun allNavigationItemsAreVisibleAndOpenTheirTabs() {
        activityRule.scenario.onActivity { activity ->
            val navHost = activity.supportFragmentManager
                .findFragmentById(R.id.nav_host) as NavHostFragment
            navHost.navController.navigate(R.id.mainShellFragment)
        }
        InstrumentationRegistry.getInstrumentation().waitForIdleSync()

        activityRule.scenario.onActivity { activity ->
            val navHost = activity.supportFragmentManager
                .findFragmentById(R.id.nav_host) as NavHostFragment
            val shell = navHost.childFragmentManager.fragments
                .filterIsInstance<MainShellFragment>()
                .single()
            shell.childFragmentManager.executePendingTransactions()
            val navigation = shell.requireView().findViewById<BottomNavigationView>(
                R.id.bottom_navigation,
            )

            assertTrue(navigation.isShown)
            assertTrue(
                navigation.height >=
                    (64 * navigation.resources.displayMetrics.density).toInt(),
            )
            assertEquals(5, navigation.menu.size())

            val destinations = listOf(
                R.id.homeTab to HomeFeedFragment::class.java,
                R.id.discoverTab to DiscoverFragment::class.java,
                R.id.createTab to CreatePostFragment::class.java,
                R.id.activityTab to ActivityFragment::class.java,
                R.id.profileTab to ProfileFragment::class.java,
            )

            for ((itemId, fragmentClass) in destinations) {
                val item = navigation.menu.findItem(itemId)
                assertNotNull(item)
                assertTrue(item.title?.isNotBlank() == true)
                assertNotNull(item.icon)

                navigation.selectedItemId = itemId
                shell.childFragmentManager.executePendingTransactions()
                val currentFragment: Fragment? =
                    shell.childFragmentManager.findFragmentById(R.id.tab_container)
                assertEquals(fragmentClass, currentFragment!!::class.java)
            }
        }
    }
}
