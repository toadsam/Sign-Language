package com.wow.signlanguage.config;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configuration.EnableWebSecurity;
import org.springframework.security.web.SecurityFilterChain;

@Configuration
@EnableWebSecurity
public class SecurityConfig {
  @Value("${app.oauth2-success-url}")
  private String oauth2SuccessUrl;

  @Bean
  public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
    http
        .cors(cors -> {})
        .csrf(csrf -> csrf.ignoringRequestMatchers("/api/**", "/translate"))
        .authorizeHttpRequests(auth -> auth
            .requestMatchers(
                "/translate",
                "/api/health",
                "/api/auth/**",
                "/api/quiz/**",
                "/choicemp4/**",
                "/clips/**",
                "/oauth2/**",
                "/login/**",
                "/error",
                "/api/users/**")
            .permitAll()
            .anyRequest().authenticated())
        .oauth2Login(oauth2 -> oauth2.defaultSuccessUrl(oauth2SuccessUrl, true))
        .logout(logout -> logout.logoutUrl("/api/auth/logout").logoutSuccessUrl("/api/health"));

    return http.build();
  }
}
