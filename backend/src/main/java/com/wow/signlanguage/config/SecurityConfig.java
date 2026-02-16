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
        .csrf(csrf -> csrf.ignoringRequestMatchers("/api/**"))
        .authorizeHttpRequests(auth -> auth
            .requestMatchers("/api/health", "/oauth2/**", "/login/**", "/error").permitAll()
            .anyRequest().authenticated())
        .oauth2Login(oauth2 -> oauth2.defaultSuccessUrl(oauth2SuccessUrl, true))
        .logout(logout -> logout.logoutUrl("/api/auth/logout").logoutSuccessUrl("/api/health"));

    return http.build();
  }
}
